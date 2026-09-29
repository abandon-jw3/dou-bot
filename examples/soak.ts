import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
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
import type { ButtonContext, MessageInput, QQDispatch } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { systemClock } from '../src/core/clock.js';
import type { Clock, Timer } from '../src/core/clock.js';
import { fixtureImage } from './fixture-image.js';

const durationMs = Number(process.argv[2] ?? 180000);
if (!Number.isSafeInteger(durationMs) || durationMs < 30000 || durationMs > 3600000)
  throw new Error('Soak duration must be 30000–3600000 milliseconds');
if (!global.gc) throw new Error('Run through npm run soak, which enables --expose-gc');

class CountingClock implements Clock {
  readonly active = new Set<Timer>();
  maximum = 0;
  monotonic(): number {
    return systemClock.monotonic();
  }
  wallTime(): number {
    return systemClock.wallTime();
  }
  timeout(callback: () => void, milliseconds: number): Timer {
    return this.schedule(callback, milliseconds, false);
  }
  interval(callback: () => void, milliseconds: number): Timer {
    return this.schedule(callback, milliseconds, true);
  }
  private schedule(callback: () => void, milliseconds: number, repeat: boolean): Timer {
    const run = () => {
      if (!repeat) this.active.delete(timer);
      callback();
    };
    const native = repeat
      ? systemClock.interval(run, milliseconds)
      : systemClock.timeout(run, milliseconds);
    const timer = {
      cancel: () => {
        native.cancel();
        this.active.delete(timer);
      },
      unref: () => native.unref(),
    };
    this.active.add(timer);
    this.maximum = Math.max(this.maximum, this.active.size);
    return timer;
  }
}

const clock = new CountingClock();
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
@Module({ controllers: [Commands] })
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
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onError(error) {
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
    fetch: (input) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
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
  const size = (name: string) => {
    const value: unknown = Reflect.get(app.execution, name);
    assert.ok(value instanceof Map || value instanceof Set, `Missing internal diagnostic: ${name}`);
    return value.size;
  };
  const result = {
    ...app.snapshot().queue,
    dedup: size('dedup'),
    replyScopes: size('scopes'),
    tasks: size('tasks'),
    signals: app.execution.managedSignals.size,
    timers: clock.active.size,
  };
  assert.ok(result.pending <= 32 && result.active <= 4 && result.retainedBytes <= 65536);
  assert.ok(
    result.dedup <= 2048 &&
      result.replyScopes <= 4096 &&
      result.tasks <= 36 &&
      result.signals <= 36,
  );
  return result;
};
const samples: Record<string, unknown>[] = [];
const startedAt = performance.now();
const cancellation = new AbortController();
const stop = () => cancellation.abort(new Error('Soak interrupted'));
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
const watchdog = setTimeout(
  () => cancellation.abort(new Error('Soak exceeded its deadline')),
  durationMs + 10000,
);
let success = false;
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
      samples.push(sample);
      console.log(JSON.stringify({ event: 'soak-progress', ...sample }));
      nextSample += 30000;
    }
    await delay(20, undefined, { signal: cancellation.signal });
  }
  assert.ok(tokenRequests > 1 && injectedFailures > 0 && reportedFailures > 0 && overloaded > 0);
  assert.equal(handled, accepted);
  assert.equal(app.snapshot().events.duplicates, duplicates);
  success = true;
} finally {
  clearTimeout(watchdog);
  await app.close();
  assert.equal(clock.active.size, 0);
  const final = inspect();
  assert.equal(
    final.dedup + final.replyScopes + final.tasks + final.signals + final.retainedBytes,
    0,
  );
  const report = {
    success,
    generatedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - startedAt),
    platform: process.platform,
    node: process.version,
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
    unexpectedErrors,
    maximumFrameworkTimers: clock.maximum,
    final,
    samples,
    scope:
      'Native-clock local sustained run with simulated HTTP and transport, deliberately short TTLs and injected errors; sampling forces GC. No QQ connection or credentials are used.',
  };
  await writeFile('work/soak-latest.json', JSON.stringify(report, null, 2) + '\n');
  console.log(
    JSON.stringify({
      event: 'soak-finished',
      success,
      accepted,
      handled,
      duplicates,
      overloaded,
      final,
    }),
  );
}
