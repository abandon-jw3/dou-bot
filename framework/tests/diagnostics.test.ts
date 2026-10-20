import assert from 'node:assert/strict';
import test from 'node:test';
import { Diagnostics, diagnosticsSettings } from '../src/diagnostics/observer.js';
import type { ObservationContext } from '../src/diagnostics/observer.js';
import type { DiagnosticsOptions, DiagnosticsSpan } from '../src/index.js';
import { Module } from '../src/index.js';
import { SingleTestApplication } from '../src/testing/single-bot.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

function recorder(options: DiagnosticsOptions = {}, random?: () => number) {
  const clock = new FakeClock();
  return {
    clock,
    recorder: new Diagnostics(diagnosticsSettings({ enabled: true, ...options }), clock, random),
  };
}

await test('diagnostics validates bounded settings and snapshots configuration without invoking exporters', () => {
  let exports = 0;
  const input = {
    enabled: true,
    traceSampleRate: 0.25,
    onSpans: () => {
      exports++;
    },
  };
  const settings = diagnosticsSettings(input);
  input.traceSampleRate = 1;
  assert.equal(settings.traceSampleRate, 0.25);
  assert.equal(Object.isFrozen(settings), true);
  assert.equal(exports, 0);
  assert.equal(diagnosticsSettings().enabled, false);
  assert.equal(diagnosticsSettings().traceSampleRate, 0);
  for (const option of [
    'maxSeries',
    'maxActiveSpans',
    'maxPendingSpans',
    'exportIntervalMs',
    'exportTimeoutMs',
  ]) {
    for (const value of [0, -1, 0.5, NaN, Infinity, '1'])
      assert.throws(() => diagnosticsSettings({ [option]: value }), {
        code: 'CONFIG',
      });
  }
  for (const traceSampleRate of [-0.1, 1.1, NaN, Infinity])
    assert.throws(() => diagnosticsSettings({ traceSampleRate }), { code: 'CONFIG' });
  assert.throws(() => diagnosticsSettings({ enabled: 'yes' } as unknown as DiagnosticsOptions), {
    code: 'CONFIG',
  });
  assert.throws(() => diagnosticsSettings({ onSpans: 1 } as unknown as DiagnosticsOptions), {
    code: 'CONFIG',
  });
  assert.throws(() => diagnosticsSettings({ unknown: true } as DiagnosticsOptions), {
    code: 'CONFIG',
  });
  assert.throws(() => diagnosticsSettings({ maxSeries: 65537 }), { code: 'CONFIG' });
});

await test('disabled diagnostics creates no stages, records, exporter work or extra timers', async () => {
  @Module({})
  class Root {}
  const clock = new FakeClock();
  let exports = 0;
  const app = await SingleTestApplication.create(
    Root,
    {
      appId: 'a',
      secret: 'fixture',
      diagnostics: {
        traceSampleRate: 1,
        onSpans() {
          exports++;
        },
      },
    },
    {
      clock,
      fetch: () => Promise.resolve(Response.json({ access_token: 'fixture', expires_in: 7200 })),
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    },
  );
  assert.equal(app.execution.observer, undefined);
  assert.equal(app.diagnostics.snapshot().enabled, false);
  assert.equal(clock.pending, 0);
  await app.start();
  assert.equal(clock.pending, 1); // Existing token refresh only.
  assert.equal(
    app.execution.accept(
      {
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id: 'm',
          content: '/unknown',
          author: { user_openid: 'user' },
        },
      },
      128,
    ).status,
    'ignored',
  );
  assert.deepEqual(app.diagnostics.snapshot().metrics, []);
  assert.deepEqual(app.diagnostics.takeSpans(), []);
  await app.close();
  assert.equal(exports, 0);
  assert.equal(clock.pending, 0);
  assert.equal(app.diagnostics.snapshot().closed, true);
});

await test('stage histograms use monotonic time, retain active age and produce immutable snapshots', async () => {
  const { clock, recorder: r } = recorder();
  const context = r.root('a');
  const first = r.start('handler.invoke', context)!;
  await clock.advance(5);
  const second = r.start('handler.invoke', context)!;
  clock.jumpWall(100000);
  await clock.advance(5);
  second.end('error');
  let metric = r.reader.snapshot().metrics[0]!;
  assert.equal(metric.active, 1);
  assert.equal(metric.oldestActiveMs, 10);
  assert.equal(metric.count, 1);
  assert.equal(metric.totalMs, 5);
  first.end();
  first.end('error');
  metric = r.reader.snapshot().metrics[0]!;
  assert.equal(metric.count, 2);
  assert.equal(metric.totalMs, 15);
  assert.equal(metric.outcomes.success, 1);
  assert.equal(metric.outcomes.error, 1);
  assert.equal(metric.p95UpperMs, 10);
  assert.equal(
    metric.buckets.reduce((a, b) => a + b, 0),
    2,
  );
  assert.equal(Object.isFrozen(metric), true);
  assert.equal(Object.isFrozen(metric.outcomes), true);
  assert.equal(Object.isFrozen(metric.buckets), true);
  assert.equal(r.reader.snapshot().bufferedSpans, 0);
  assert.equal(clock.pending, 0);
  await r.close(clock.monotonic() + 100);
  const elapsed = r.reader.snapshot().elapsedMs;
  await clock.advance(100);
  assert.equal(r.reader.snapshot().elapsedMs, elapsed);
});

await test('histogram overflow does not invent a finite percentile upper bound', async () => {
  const { clock, recorder: r } = recorder();
  const span = r.start('handler.invoke')!;
  await clock.advance(60001);
  span.end();
  const metric = r.reader.snapshot().metrics[0]!;
  assert.equal(metric.p99UpperMs, null);
  assert.equal(metric.buckets.at(-1), 1);
  await r.close(Infinity);
});

await test('sampling is chosen at roots and preserves child and signal correlation', async () => {
  const { clock, recorder: r } = recorder({ traceSampleRate: 0.5 }, () => 0.25);
  const root = r.root('a');
  const parent = r.start('event.total', root)!;
  const signal = new AbortController().signal;
  r.bind(signal, parent.context);
  const combined = new AbortController().signal;
  r.inherit(signal, combined);
  const child = r.start('handler.invoke', r.context(combined))!;
  assert.equal(parent.context.traceId, child.context.traceId);
  assert.equal(child.parentSpanId, parent.spanId);
  assert.notEqual(r.root('a').traceId, root.traceId);
  child.end();
  parent.end();
  const spans = r.reader.takeSpans();
  assert.equal(spans.length, 2);
  assert.ok(spans.every((span) => span.traceId === root.traceId));
  assert.ok(Object.isFrozen(spans) && spans.every(Object.isFrozen));
  assert.equal(r.reader.takeSpans().length, 0);
  r.unbind(signal);
  r.unbind(combined);
  assert.equal(r.context(combined), undefined);
  assert.equal(clock.pending, 0);
  const unsampled = recorder({ traceSampleRate: 0.5 }, () => 0.75).recorder;
  assert.equal(unsampled.root('a').traceId, undefined);
  await r.close(Infinity);
  await unsampled.close(Infinity);
});

await test('metric series, live observations and sampled records each have independent bounds', async () => {
  const { recorder: r } = recorder({
    maxSeries: 1,
    maxActiveSpans: 2,
    maxPendingSpans: 1,
    traceSampleRate: 1,
  });
  const root = r.root('a');
  const first = r.start('handler.invoke', root)!;
  const second = r.start('handler.invoke', root)!;
  assert.equal(r.start('handler.invoke', root), undefined);
  first.end();
  second.end();
  assert.equal(r.start('handler.guard', root), undefined);
  const snapshot = r.reader.snapshot();
  assert.equal(snapshot.metrics.length, 1);
  assert.equal(snapshot.metrics[0]!.count, 2);
  assert.equal(snapshot.activeSpans, 0);
  assert.equal(snapshot.bufferedSpans, 1);
  assert.equal(snapshot.droppedMeasurements, 2);
  assert.equal(snapshot.droppedSpans, 3);
  await r.close(Infinity);
});

await test('series indexing preserves every label dimension, mutable contexts and snapshot order', async () => {
  const { recorder: r } = recorder();
  const contexts: ObservationContext[] = [
    {},
    { appId: 'undefined' },
    { appId: 'a', handler: 'Commands.read', component: 0, operation: 'message' },
    { appId: 'b', handler: 'Commands.read', component: 0, operation: 'message' },
    { appId: 'a', handler: 'Commands.write', component: 0, operation: 'message' },
    { appId: 'a', handler: 'Commands.read', component: 1, operation: 'message' },
    { appId: 'a', handler: 'Commands.read', component: 0, operation: 'upload' },
    { appId: 'a|b', handler: 'c' },
    { appId: 'a', handler: 'b|c' },
  ];
  for (const context of contexts) {
    r.start('handler.invoke', context)!.end();
    r.start('handler.invoke', { ...context })!.end('error');
  }
  const changing = { appId: 'first' };
  const pending = r.start('handler.invoke', changing)!;
  changing.appId = 'second';
  r.start('handler.invoke', changing)!.end();
  pending.end();
  const metrics = r.reader.snapshot().metrics;
  assert.equal(metrics.length, contexts.length + 2);
  contexts.forEach((context, index) => {
    const metric = metrics[index]!;
    for (const key of ['appId', 'handler', 'component', 'operation'] as const)
      assert.equal(metric[key], context[key]);
    assert.equal(metric.count, 2);
    assert.equal(metric.outcomes.success, 1);
    assert.equal(metric.outcomes.error, 1);
  });
  assert.deepEqual(
    metrics.slice(-2).map((metric) => metric.appId),
    ['first', 'second'],
  );
  await r.close(Infinity);
});

await test('rejected series cannot consume label budget or alias truncated handler names', async () => {
  const { recorder: r } = recorder({ maxSeries: 3 });
  const prefix = 'x'.repeat(256);
  for (const handler of [prefix, prefix + 'a', prefix + 'b'])
    r.start('handler.invoke', { handler })!.end();
  for (let index = 0; index < 1000; index++)
    assert.equal(r.start('event.queue', { appId: `rejected-${index}` }), undefined);
  for (const handler of [prefix + 'b', prefix, prefix + 'a'])
    r.start('handler.invoke', { handler })!.end();
  const snapshot = r.reader.snapshot();
  assert.equal(snapshot.metrics.length, 3);
  assert.ok(snapshot.metrics.every((metric) => metric.handler === prefix && metric.count === 2));
  assert.equal(snapshot.droppedMeasurements, 1000);
  await r.close(Infinity);
});

await test('unknown accounts are excluded from labels and close ends active intervals exactly once', async () => {
  const clock = new FakeClock();
  const r = new Diagnostics(
    diagnosticsSettings({ enabled: true, traceSampleRate: 1 }),
    clock,
    undefined,
    new Set(['a']),
  );
  const controller = new AbortController();
  const first = r.start(
    'handler.invoke',
    { appId: 'untrusted-private-identifier' },
    controller.signal,
  )!;
  const other = r.start('event.total', r.root('a'))!;
  controller.abort(new Error('private-error-text'));
  assert.equal(r.reader.snapshot().activeSpans, 1);
  await r.close(clock.monotonic() + 10);
  other.end();
  first.end();
  const snapshot = r.reader.snapshot();
  assert.equal(snapshot.activeSpans, 0);
  assert.equal(
    snapshot.metrics.reduce((n, x) => n + x.count, 0),
    2,
  );
  assert.equal(
    snapshot.metrics.reduce((n, x) => n + x.outcomes.cancelled, 0),
    2,
  );
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(r.start('handler.invoke'), undefined);
  assert.equal(clock.pending, 0);
});

await test('export is deferred, batched and idle without records', async () => {
  const batches: (readonly DiagnosticsSpan[])[] = [];
  const { clock, recorder: r } = recorder({
    traceSampleRate: 1,
    onSpans(spans, signal) {
      assert.equal(signal.aborted, false);
      batches.push(spans);
    },
  });
  assert.equal(clock.pending, 0);
  r.start('handler.invoke', r.root('a'))!.end();
  r.start('handler.invoke', r.root('a'))!.end();
  assert.equal(batches.length, 0);
  assert.equal(clock.pending, 1);
  await clock.advance(999);
  assert.equal(batches.length, 0);
  await clock.advance(1);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.length, 2);
  assert.equal(r.reader.snapshot().exportingSpans, 0);
  assert.equal(clock.pending, 0);
  await r.close(Infinity);
});

await test('a timed-out exporter cannot retain an unbounded series of batches or affect metrics', async () => {
  const pending = deferred<void>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  const { clock, recorder: r } = recorder({
    traceSampleRate: 1,
    maxPendingSpans: 2,
    exportIntervalMs: 1,
    exportTimeoutMs: 5,
    onSpans(_spans, current) {
      calls++;
      signal = current;
      return pending.promise;
    },
  });
  const root = r.root('a');
  r.start('handler.invoke', root)!.end();
  r.start('handler.invoke', root)!.end();
  await clock.advance(1);
  assert.equal(r.reader.snapshot().exportingSpans, 2);
  r.start('handler.invoke', root)!.end();
  assert.equal(r.reader.snapshot().droppedSpans, 1);
  await clock.advance(5);
  assert.equal(signal?.aborted, true);
  assert.equal(r.reader.snapshot().exportFailures, 1);
  assert.equal(r.reader.snapshot().exportDisabled, true);
  assert.equal(r.reader.snapshot().exportingSpans, 2);
  for (let index = 0; index < 20; index++) r.start('handler.invoke', root)!.end();
  await clock.advance(100);
  assert.equal(calls, 1);
  assert.equal(r.reader.snapshot().bufferedSpans, 0);
  assert.equal(r.reader.snapshot().metrics[0]!.count, 23);
  pending.reject(new Error('late exporter failure'));
  await clock.flush();
  assert.equal(r.reader.snapshot().exportingSpans, 0);
  assert.equal(r.reader.snapshot().exportFailures, 1);
  r.start('handler.invoke', root)!.end();
  assert.equal(r.reader.takeSpans().length, 1);
  await r.close(Infinity);
  assert.equal(clock.pending, 0);
});

for (const invalid of ['throw', 'return'] as const) {
  await test(`invalid exporter ${invalid} disables automatic delivery without unhandled rejection`, async () => {
    const { clock, recorder: r } = recorder({
      traceSampleRate: 1,
      exportIntervalMs: 1,
      onSpans: (() => {
        if (invalid === 'throw') throw new Error('export failure');
        return 'invalid';
      }) as unknown as NonNullable<DiagnosticsOptions['onSpans']>,
    });
    r.start('handler.invoke', r.root())!.end();
    await clock.advance(1);
    assert.equal(r.reader.snapshot().exportFailures, 1);
    assert.equal(r.reader.snapshot().exportDisabled, true);
    assert.equal(clock.pending, 0);
    await r.close(Infinity);
  });
}

await test('close cancels a running export and preserves the charge for its late result', async () => {
  const pending = deferred<void>();
  let signal: AbortSignal | undefined;
  const { clock, recorder: r } = recorder({
    traceSampleRate: 1,
    exportIntervalMs: 1,
    onSpans(_spans, current) {
      signal = current;
      return pending.promise;
    },
  });
  r.start('handler.invoke', r.root())!.end();
  await clock.advance(1);
  await r.close(clock.monotonic() + 100);
  assert.equal(signal?.aborted, true);
  assert.equal(r.reader.snapshot().exportingSpans, 1);
  assert.equal(r.reader.snapshot().exportFailures, 0);
  assert.equal(clock.pending, 0);
  pending.resolve();
  await clock.flush();
  assert.equal(r.reader.snapshot().exportingSpans, 0);
});
