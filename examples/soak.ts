import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Arg,
  Command,
  Controller,
  Ctx,
  Module,
  OnButton,
  QQApiError,
  image,
  markdown,
  keyboard,
  button,
} from '../src/index.js';
import type { ButtonContext, MessageInput, QQDispatch, QQMessagePayload } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { CountingClock, inspectResources, assertReleased, closeOnAbort } from './soak-support.js';
import { createControlWorkload } from './soak-controls.js';
import { fixtureImage } from './fixture-image.js';

const durationMs = Number(process.argv[2] ?? 180000);
if (!Number.isSafeInteger(durationMs) || durationMs < 30000 || durationMs > 259200000)
  throw new Error('Soak duration must be 30000–259200000 milliseconds');
if (!global.gc) throw new Error('Run through npm run soak, which enables --expose-gc');

const clock = new CountingClock();
const controls = createControlWorkload();
const seen = new Uint32Array(8192);
const png = fixtureImage();
let handled = 0;
let accepted = 0;
let duplicates = 0;
let overloaded = 0;
let tokenRequests = 0;
let sends = 0;
let uploads = 0;
let acknowledgments = 0;
let injectedFailures = 0;
let reportedFailures = 0;
let unexpectedErrors = 0;
const remember = (value: string) => {
  const id = Number(value);
  assert.ok(Number.isSafeInteger(id) && id >= 0);
  assert.notEqual(seen[id % seen.length], id + 1, 'Business handler executed twice');
  seen[id % seen.length] = id + 1;
  handled++;
};
@Controller()
class Commands {
  @Command('ping') ping(@Arg(0) value: string): MessageInput {
    remember(value);
    const id = Number(value);
    if (id % 17 === 0) return image(png);
    if (id % 19 === 0)
      return markdown('**soak**', {
        keyboard: keyboard([[button.callback('press', 'Press', value)]]),
      });
    return 'pong';
  }
  @OnButton('press') async pressed(@Ctx() context: ButtonContext): Promise<void> {
    remember(context.data);
    await context.ack();
    await context.send('button handled');
  }
}
@Module({ imports: [controls.module], controllers: [Commands] })
class Root {}
const app = await Application.create(
  Root,
  {
    appId: 'soak-fixture-app',
    secret: 'soak-fixture-secret',
    execution: {
      concurrency: 4,
      queueCapacity: 32,
      maxEventBytes: 4096,
      queueMaxBytes: 65536,
      dedupMaxEntries: 2048,
      replyScopeMaxEntries: 4096,
      dedupTtlMs: 500,
      replyScopeTtlMs: 1000,
      cooldownMaxEntries: 4096,
      shutdownTimeoutMs: 1000,
    },
    prompts: { maxPending: 8 },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onError(error, context) {
      if (controls.report(error, context)) return;
      if (
        error instanceof QQApiError &&
        typeof error.qqCode === 'number' &&
        [100017, 11253, 40001].includes(error.qqCode)
      )
        reportedFailures++;
      else unexpectedErrors++;
    },
  },
  {
    clock,
    transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    fetch: (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (typeof init?.body === 'string') {
        const response = controls.respond(url.pathname, JSON.parse(init.body) as QQMessagePayload);
        if (response) return Promise.resolve(response);
      }
      const fail = (code: number) => {
        injectedFailures++;
        return Response.json({ code, message: 'Deliberate local soak failure' });
      };
      if (url.pathname === '/app/getAppAccessToken') {
        tokenRequests++;
        return Promise.resolve(
          tokenRequests % 11 === 0
            ? fail(40001)
            : Response.json({ access_token: `soak-token-${tokenRequests}`, expires_in: 5 }),
        );
      }
      if (url.pathname.endsWith('/files')) {
        uploads++;
        return Promise.resolve(Response.json({ file_info: 'soak-file', ttl: 30 }));
      }
      if (url.pathname.startsWith('/interactions/')) {
        acknowledgments++;
        return Promise.resolve(
          acknowledgments % 701 === 0 ? fail(11253) : new Response(null, { status: 204 }),
        );
      }
      if (url.pathname.endsWith('/messages')) {
        sends++;
        return Promise.resolve(
          sends % 1009 === 0 ? fail(100017) : Response.json({ id: `sent-${sends}` }),
        );
      }
      throw new Error('Unexpected soak HTTP endpoint');
    },
  },
);
const inspect = () => {
  const result = inspectResources(app, clock);
  assert.ok(result.pending <= 32 && result.active <= 4 && result.retainedBytes <= 65536);
  assert.ok(result.dedup <= 2048 && result.replyScopes <= 4096);
  // A suspended prompt and its captured answers remain owned by the parent workflow.
  assert.ok(result.tasks <= 36 + 8 * 33 && result.signals <= 36 + 8 * 33);
  assert.ok(result.prompts <= 8 && result.cooldowns <= 4096);
  return result;
};
async function sourceFiles(directory: string): Promise<string[]> {
  const paths: string[] = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) paths.push(...(await sourceFiles(path)));
    else if (item.isFile() && item.name.endsWith('.ts')) paths.push(path);
  }
  return paths;
}
const sourceHash = createHash('sha256');
for (const file of [
  ...(await sourceFiles('src')),
  'examples/soak.ts',
  'examples/soak-controls.ts',
  'examples/soak-support.ts',
].sort()) {
  sourceHash
    .update(file)
    .update('\0')
    .update(await readFile(file))
    .update('\0');
}
const source = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  dirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  sha256: sourceHash.digest('hex'),
};
const manifest: unknown = JSON.parse(await readFile('package.json', 'utf8'));
assert.ok(manifest && typeof manifest === 'object' && 'version' in manifest);
assert.equal(typeof manifest.version, 'string');
const sdkVersion = manifest.version as string;
const samples: Record<string, unknown>[] = [];
let sampleCount = 0;
let maximumHeapUsed = 0;
let maximumRss = 0;
const startedAt = performance.now();
const cancellation = new AbortController();
const stopOnAbort = closeOnAbort(app, cancellation.signal);
const stop = () => cancellation.abort(new Error('Soak interrupted'));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const watchdog = setTimeout(
  () => cancellation.abort(new Error('Soak exceeded its deadline')),
  durationMs + 10000,
);
let completed = false;
let shutdownPrepared = false;
let failure: Error | undefined;
try {
  await app.start();
  let sequence = 0;
  let nextSample = startedAt;
  while (performance.now() - startedAt < durationMs) {
    for (let batch = 0; batch < 64; batch++, sequence++) {
      cancellation.signal.throwIfAborted();
      const payload: QQDispatch =
        sequence % 10 === 0
          ? {
              op: 0,
              t: 'INTERACTION_CREATE',
              d: {
                id: `event-${sequence}`,
                chat_type: 2,
                user_openid: 'fixture-user',
                data: { resolved: { button_id: 'press', button_data: String(sequence) } },
              },
            }
          : {
              op: 0,
              t: sequence % 2 ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
              d: {
                id: `event-${sequence}`,
                group_openid: 'fixture-group',
                author: { id: 'fixture-user' },
                content: `/ping ${sequence}`,
              },
            };
      const bytes = Buffer.byteLength(JSON.stringify(payload));
      let admission = app.execution.accept(payload, bytes);
      while (admission.status === 'overloaded') {
        overloaded++;
        await app.execution.waitForCapacity(cancellation.signal);
        admission = app.execution.accept(payload, bytes);
      }
      assert.equal(admission.status, 'accepted');
      accepted++;
      if (sequence % 9 === 0) {
        assert.equal(app.execution.accept(payload, bytes).status, 'duplicate');
        duplicates++;
      }
      inspect();
    }
    await app.execution.idle();
    assert.equal(handled, accepted);
    await controls.cycle(app, cancellation.signal);
    assert.equal(unexpectedErrors, 0);
    if (performance.now() >= nextSample) {
      global.gc();
      const sample = {
        elapsedMs: Math.round(performance.now() - startedAt),
        accepted,
        overloaded,
        heapUsed: process.memoryUsage().heapUsed,
        rss: process.memoryUsage().rss,
        resources: inspect(),
      };
      sampleCount++;
      maximumHeapUsed = Math.max(maximumHeapUsed, sample.heapUsed);
      maximumRss = Math.max(maximumRss, sample.rss);
      samples.push(sample);
      if (samples.length > 240) samples.shift();
      console.log(JSON.stringify({ event: 'soak-progress', ...sample }));
      nextSample += 30000;
    }
    await delay(20, undefined, { signal: cancellation.signal });
  }
  cancellation.signal.throwIfAborted();
  assert.ok(tokenRequests > 1 && injectedFailures > 0 && reportedFailures > 0 && overloaded > 0);
  assert.equal(handled, accepted);
  assert.equal(app.snapshot().events.duplicates, duplicates + controls.stats.duplicates);
  assert.ok(controls.stats.cycles > 0);
  await controls.prepareShutdown(app, cancellation.signal);
  shutdownPrepared = true;
  completed = true;
} catch (error) {
  failure = error instanceof Error ? error : new Error('Unknown soak failure', { cause: error });
} finally {
  clearTimeout(watchdog);
  stopOnAbort();
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
  try {
    await app.close();
    if (shutdownPrepared) await controls.verifyShutdown();
    assertReleased(app, clock);
    assert.equal(unexpectedErrors, 0, 'Unexpected errors during workload shutdown');
    assert.equal(app.snapshot().events.accepted, accepted + controls.stats.accepted);
  } catch (error) {
    failure ??=
      error instanceof Error ? error : new Error('Unknown cleanup failure', { cause: error });
  }
  const success = completed && failure === undefined;
  const final = inspectResources(app, clock);
  const report = {
    schemaVersion: 2,
    success,
    generatedAt: new Date().toISOString(),
    requestedDurationMs: durationMs,
    durationMs: Math.round(performance.now() - startedAt),
    platform: process.platform,
    node: process.version,
    sdkVersion,
    source,
    events: app.snapshot().events,
    bulk: {
      accepted,
      handled,
      duplicates,
      overloaded,
      tokenRequests,
      sends,
      uploads,
      acknowledgments,
      injectedFailures,
      reportedFailures,
    },
    controls: controls.stats,
    unexpectedErrors,
    maximumFrameworkTimers: clock.maximum,
    maximumHeapUsed,
    maximumRss,
    sampleCount,
    droppedSamples: sampleCount - samples.length,
    final,
    samples,
    ...(failure === undefined
      ? {}
      : { failure: failure instanceof Error ? failure.message : 'Unknown failure' }),
    scope:
      'Native-clock local sustained run with simulated HTTP and transport, short TTLs and injected errors. Includes guards, slot/rest/option, cooldown, private/group multi-turn prompts, cancellation, timeout, question failure and shutdown. Samples force GC and retain at most 240 points. This is not QQ platform or multi-day production acceptance.',
  };
  const reportPath = `work/soak-${randomUUID()}.json`;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile('work/soak-latest.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      event: 'soak-finished',
      success,
      reportPath,
      events: report.events,
      controls: controls.stats,
      final,
    }),
  );
}
if (failure !== undefined) throw failure;
