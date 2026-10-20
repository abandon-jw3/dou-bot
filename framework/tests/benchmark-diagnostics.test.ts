import assert from 'node:assert/strict';
import test from 'node:test';
import { DiagnosticsTimeline, diagnosticsWindow } from '../examples/mixed-benchmark/diagnostics.js';
import { Diagnostics, diagnosticsSettings } from '../src/diagnostics/observer.js';
import { FakeClock } from './fake-clock.js';

await test('diagnostic windows recompute quantiles, preserve in-flight gauges and mark phase transitions', async () => {
  const clock = new FakeClock();
  const reader = new Diagnostics(diagnosticsSettings({ enabled: true }), clock);
  const timeline = new DiagnosticsTimeline(
    reader.reader,
    true,
    () => BigInt(clock.monotonic()) * 1000000n,
  );
  timeline.capture('warmup');
  const first = reader.start('event.queue')!;
  await clock.advance(100);
  first.end();
  await clock.advance(4900);
  timeline.capture('steady');
  const second = reader.start('event.queue')!;
  await clock.advance(1);
  second.end('rejected');
  const pending = reader.start('event.queue')!;
  const newSeries = reader.start('qq.http', { operation: 'message' })!;
  await clock.advance(4999);
  newSeries.end();
  timeline.capture('steady');
  const report = timeline.report();
  assert.equal(report.windows[0]!.crossesPhase, true);
  const window = report.windows[1]!;
  assert.equal(window.crossesPhase, false);
  assert.equal(window.durationMs, 5000);
  const queue = window.metrics.find((metric) => metric.stage === 'event.queue')!;
  assert.equal(queue.count, 1);
  assert.equal(queue.totalMs, 1);
  assert.equal(queue.p95UpperMs, 1); // Cumulative P95 remains 100.
  assert.equal(queue.completedPerSecond, 0.2);
  assert.equal(queue.outcomes.rejected, 1);
  assert.equal(queue.activeAtEnd, 1);
  assert.equal(queue.oldestActiveMsAtEnd, 4999);
  assert.equal('maxMs' in queue, false);
  assert.equal(window.metrics.find((metric) => metric.stage === 'qq.http')!.count, 1);
  assert.throws(() => diagnosticsWindow(report.samples[1]!, report.samples[0]!));
  assert.throws(() =>
    diagnosticsWindow(report.samples[2]!, { ...report.samples[0]!, atNs: '20000000000' }),
  );
  pending.end();
  await reader.close(Infinity);
});

await test('diagnostic timeline bounds snapshots and avoids reads when disabled or before its interval', async () => {
  const clock = new FakeClock();
  const reader = new Diagnostics(diagnosticsSettings({ enabled: true }), clock);
  let reads = 0;
  const tracked = {
    snapshot() {
      reads++;
      return reader.reader.snapshot();
    },
    takeSpans: () => reader.reader.takeSpans(),
  };
  const monotonic = () => BigInt(clock.monotonic()) * 1000000n;
  new DiagnosticsTimeline(tracked, false, monotonic).capture('steady', true);
  assert.equal(reads, 0);
  const timeline = new DiagnosticsTimeline(tracked, true, monotonic);
  timeline.capture('steady');
  timeline.capture('steady', true); // Same instant is not a new window.
  await clock.advance(1000);
  timeline.capture('steady');
  assert.equal(reads, 1);
  timeline.capture('recovery');
  assert.equal(reads, 2);
  for (let i = 0; i < 260; i++) {
    await clock.advance(5000);
    timeline.capture('recovery');
  }
  const report = timeline.report();
  assert.equal(report.samples.length, 256);
  assert.equal(reads, 256);
  assert.equal(report.droppedSamples, 6);
  assert.equal(report.windows.length, 255);
  await reader.close(Infinity);
});
