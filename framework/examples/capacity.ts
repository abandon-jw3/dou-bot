import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import {
  Arg,
  Command,
  ContextValue,
  Controller,
  createContextKey,
  Injectable,
  Module,
  UseMiddleware,
} from '../src/index.js';
import type {
  BotSnapshot,
  ContextMiddleware,
  ExecutionOptions,
  MiddlewareContext,
  QQDispatch,
} from '../src/index.js';
import { SingleTestApplication as Application } from '../src/testing/single-bot.js';
import type { Clock } from '../src/core/clock.js';
import { FakeClock } from '../tests/fake-clock.js';
import { CountingClock, assertReleased, inspectResources } from './soak-support.js';

// Deliberate deployment profile, not a change to SDK defaults or a platform quota.
export const capacityProfile = Object.freeze({
  concurrency: 32,
  queueCapacity: 2000,
  queueMaxBytes: 32 * 1024 * 1024,
  dedupMaxEntries: 50000,
  replyScopeMaxEntries: 200000,
} satisfies ExecutionOptions);

const mode = process.argv[2] ?? 'virtual';
const durationMs = Number(process.argv[3] ?? (mode === 'virtual' ? 7200000 : 3900000));
const label = process.argv[4] ?? mode;
if (
  !['virtual', 'realtime'].includes(mode) ||
  !Number.isSafeInteger(durationMs) ||
  durationMs < 1000 ||
  durationMs > 86400000 ||
  !/^[a-z0-9-]+$/u.test(label)
)
  throw new Error('Usage: benchmark:capacity [virtual|realtime] [1000..86400000 ms] [label]');
const hash = createHash('sha256');
for (const path of (await readdir('src', { recursive: true }))
  .filter((p) => p.endsWith('.ts'))
  .sort()) {
  hash.update(`src/${path}`);
  hash.update(await readFile(`src/${path}`));
}
const sourceSha256 = hash.digest('hex');

const virtual = mode === 'virtual' ? new FakeClock() : undefined;
const real = new CountingClock();
const clock: Clock = virtual ?? real;
const controller = new AbortController();
const interrupt = () => controller.abort(new Error('Capacity run interrupted'));
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timer = clock.timeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      timer.cancel();
      signal.removeEventListener('abort', abort);
      reject(
        signal.reason instanceof Error ? signal.reason : new Error('Capacity operation aborted'),
      );
    };
    signal.addEventListener('abort', abort, { once: true });
  });
}
const identity = createContextKey<string>('capacity.group');
let loaded = 0;
let handled = 0;
let sent = 0;
let injectedFailures = 0;
const failures: Record<string, number> = {};
@Injectable()
class Data implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    assert.ok(ctx.scene === 'group');
    const groupId = ctx.groupId;
    ctx.state.provide(identity, async (signal) => {
      const index = Number(ctx.kind === 'command' ? ctx.content.split(' ')[1] : NaN);
      await delay(index % 20 === 0 ? 2000 : 50, signal);
      loaded++;
      return groupId;
    });
  }
}
@Controller()
@UseMiddleware(Data)
class Commands {
  @Command('load') load(@Arg(0) index: string, @ContextValue(identity) group: string): string {
    assert.equal(group, `group-${Number(index) % 5 === 0 ? 0 : 1 + (Number(index) % 1999)}`);
    handled++;
    return 'ok';
  }
}
@Module({ controllers: [Commands], providers: [Data] })
class Root {}

const samples: {
  elapsedMs: number;
  heapUsed: number;
  rss: number;
  snapshot: BotSnapshot;
}[] = [];
const latencyBounds = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, Infinity];
const latencies = latencyBounds.map(() => 0);
let maxLatencyMs = 0;
let maxSchedulingLagMs = 0;
let attempted = 0;
let duplicates = 0;
const groups = new Set<string>();
const app = await Application.create(
  Root,
  {
    appId: 'capacity-fixture',
    secret: 'capacity-fixture-secret',
    execution: capacityProfile,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onError: (_error, context) => {
      failures[context.phase] = (failures[context.phase] ?? 0) + 1;
    },
  },
  {
    clock,
    transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    fetch: async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.endsWith('/app/getAppAccessToken'))
        return Response.json({ access_token: 'capacity-fixture-token', expires_in: 7200 });
      const index = ++sent;
      await delay(150, init?.signal ?? controller.signal);
      if (index % 997 === 0) {
        injectedFailures++;
        return Response.json(
          { code: 500, message: 'deliberate capacity fixture failure' },
          { status: 503 },
        );
      }
      return Response.json({ id: `sent-${index}` });
    },
  },
);
await app.start();
const started = clock.monotonic();
const wallStarted = performance.now();
let nextSample = 60000;
let snapshot = app.snapshot();
let result: 'passed' | 'failed' = 'failed';
let error: string | undefined;
try {
  let scheduled = 0;
  while (scheduled < durationMs) {
    controller.signal.throwIfAborted();
    const wait = Math.max(0, started + scheduled - clock.monotonic());
    if (virtual) await virtual.advance(wait);
    else if (wait > 0) await sleep(wait, undefined, { signal: controller.signal });
    maxSchedulingLagMs = Math.max(maxSchedulingLagMs, clock.monotonic() - started - scheduled);
    const group = `group-${attempted % 5 === 0 ? 0 : 1 + (attempted % 1999)}`;
    groups.add(group);
    const payload: QQDispatch = {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: `capacity-${attempted}`,
        group_openid: group,
        author: { member_openid: `user-${attempted % 100}` },
        content: `/load ${attempted}`,
      },
    };
    const bytes = Buffer.byteLength(JSON.stringify(payload));
    const admittedAt = clock.monotonic();
    const admission = app.execution.accept(payload, bytes);
    assert.equal(admission.status, 'accepted');
    if ('done' in admission)
      admission.done
        .then(() => {
          const elapsed = clock.monotonic() - admittedAt;
          maxLatencyMs = Math.max(maxLatencyMs, elapsed);
          latencies[latencyBounds.findIndex((bound) => elapsed <= bound)]!++;
        })
        .catch((cause: unknown) => controller.abort(cause));
    if (attempted % 25 === 0) {
      assert.equal(app.execution.accept(payload, bytes).status, 'duplicate');
      duplicates++;
    }
    attempted++;
    if (scheduled >= nextSample) {
      if (samples.length % 5 === 0) global.gc?.();
      const memory = process.memoryUsage();
      snapshot = app.snapshot();
      samples.push({ elapsedMs: scheduled, heapUsed: memory.heapUsed, rss: memory.rss, snapshot });
      if (samples.length > 1440) samples.shift();
      console.log(
        JSON.stringify({
          mode,
          elapsedMs: scheduled,
          accepted: snapshot.events.accepted,
          queue: snapshot.queue.pending,
          replyScopes: snapshot.capacity.replyScopes.size,
          rejected: snapshot.events.rejected,
          errors: snapshot.events.failed,
        }),
      );
      nextSample += 60000;
    }
    // Fixed arrivals: 20/s normally and 50/s for the first 30 seconds of each ten minutes.
    scheduled += scheduled % 600000 < 30000 ? 20 : 50;
  }
  if (virtual) await virtual.advance(5000);
  await app.execution.idle();
  snapshot = app.snapshot();
  assert.equal(snapshot.events.accepted, attempted);
  assert.equal(snapshot.events.duplicates, duplicates);
  assert.equal(snapshot.events.rejected, 0);
  assert.equal(snapshot.events.failed, injectedFailures);
  assert.equal(
    Object.values(failures).reduce((a, b) => a + b, 0),
    injectedFailures,
  );
  assert.equal(loaded, attempted);
  assert.equal(handled, attempted);
  assert.equal(sent, attempted);
  assert.equal(
    latencies.reduce((a, b) => a + b, 0),
    attempted,
  );
  if (attempted >= 10000) assert.equal(groups.size, 2000);
  result = 'passed';
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  const closing = app.close();
  if (virtual) await virtual.advance(10000);
  await closing;
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
}
assertReleased(app, real);
if (virtual) assert.equal(virtual.pending, 0);
const report = {
  result,
  error,
  mode,
  node: process.version,
  platform: process.platform,
  sourceSha256,
  requestedDurationMs: durationMs,
  applicationElapsedMs: clock.monotonic() - started,
  actualElapsedMs: performance.now() - wallStarted,
  workload: {
    groups: groups.size,
    normalEventsPerSecond: 20,
    burstEventsPerSecond: 50,
    burstMs: 30000,
    burstEveryMs: 600000,
    hotGroupFraction: 0.2,
    slowFraction: 0.05,
    loadDelayMs: 50,
    slowLoadDelayMs: 2000,
    sendDelayMs: 150,
  },
  profile: capacityProfile,
  attempted,
  duplicates,
  handled,
  loaded,
  sent,
  injectedFailures,
  failures,
  maxLatencyMs,
  maxSchedulingLagMs,
  latencyHistogram: latencyBounds.map((upperMs, i) => ({
    upperMs: Number.isFinite(upperMs) ? upperMs : null,
    count: latencies[i],
  })),
  snapshot,
  samples,
  released: inspectResources(app, real),
  limits:
    'Synthetic HTTP and handler delays; no QQ or database connection. Virtual time is not wall-clock endurance.',
};
await mkdir('work/capacity-review', { recursive: true });
const path = `work/capacity-review/${label}.json`;
await writeFile(path, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ result, path, attempted, actualElapsedMs: report.actualElapsedMs }));
if (result !== 'passed') process.exitCode = 1;
