import assert from 'node:assert/strict';
import type { DiagnosticsMetric, DiagnosticsReader, DiagnosticsSnapshot } from '../../src/index.js';

export interface DiagnosticsSample {
  atNs: string;
  phase: string;
  collectionMs: number;
  snapshot: DiagnosticsSnapshot;
}

const identity = (metric: DiagnosticsMetric) =>
  JSON.stringify([metric.stage, metric.appId, metric.handler, metric.component, metric.operation]);

/** Subtract cumulative counters, then recompute quantiles from the window's own bins. */
export function diagnosticsWindow(before: DiagnosticsSample, after: DiagnosticsSample) {
  const durationMs = Number(BigInt(after.atNs) - BigInt(before.atNs)) / 1e6;
  assert.ok(durationMs > 0, 'Diagnostic samples must advance monotonically');
  assert.deepEqual(before.snapshot.bucketUpperBoundsMs, after.snapshot.bucketUpperBoundsMs);
  const previous = new Map(before.snapshot.metrics.map((metric) => [identity(metric), metric]));
  const current = new Set(after.snapshot.metrics.map(identity));
  assert.ok(
    [...previous.keys()].every((key) => current.has(key)),
    'Diagnostic series disappeared',
  );
  const difference = (current: number, prior = 0) => {
    assert.ok(current >= prior, 'Diagnostic counters reset within a run');
    return current - prior;
  };
  const metrics = after.snapshot.metrics.map((metric) => {
    const prior = previous.get(identity(metric));
    const count = difference(metric.count, prior?.count);
    const totalMs = difference(metric.totalMs, prior?.totalMs);
    const buckets = metric.buckets.map((value, index) => difference(value, prior?.buckets[index]));
    assert.equal(
      buckets.reduce((sum, value) => sum + value, 0),
      count,
    );
    const quantile = (fraction: number) => {
      if (!count) return null;
      const target = Math.ceil(count * fraction);
      let accumulated = 0;
      for (let index = 0; index < buckets.length; index++) {
        accumulated += buckets[index]!;
        if (accumulated >= target) return after.snapshot.bucketUpperBoundsMs[index] ?? null;
      }
      return null;
    };
    return {
      stage: metric.stage,
      appId: metric.appId,
      handler: metric.handler,
      component: metric.component,
      operation: metric.operation,
      count,
      totalMs,
      completedPerSecond: (count * 1000) / durationMs,
      meanCompletedMs: count ? totalMs / count : null,
      p50UpperMs: quantile(0.5),
      p95UpperMs: quantile(0.95),
      p99UpperMs: quantile(0.99),
      buckets,
      outcomes: Object.fromEntries(
        Object.entries(metric.outcomes).map(([key, value]) => [
          key,
          difference(value, prior?.outcomes[key as keyof typeof metric.outcomes]),
        ]),
      ),
      // Gauges belong to the end of the window; maxima cannot be subtracted.
      activeAtEnd: metric.active,
      oldestActiveMsAtEnd: metric.oldestActiveMs,
    };
  });
  return {
    fromNs: before.atNs,
    toNs: after.atNs,
    durationMs,
    fromPhase: before.phase,
    toPhase: after.phase,
    crossesPhase: before.phase !== after.phase,
    droppedMeasurements: difference(
      after.snapshot.droppedMeasurements,
      before.snapshot.droppedMeasurements,
    ),
    droppedSpans: difference(after.snapshot.droppedSpans, before.snapshot.droppedSpans),
    exportFailures: difference(after.snapshot.exportFailures, before.snapshot.exportFailures),
    metrics,
  };
}

/** Benchmark-only recorder. Large snapshots never travel through live control frames. */
export class DiagnosticsTimeline {
  readonly intervalMs = 5000;
  readonly limit = 256;
  private readonly samples: DiagnosticsSample[] = [];
  private droppedSamples = 0;
  private lastAt?: bigint;
  private lastPhase?: string;

  constructor(
    private readonly reader: DiagnosticsReader,
    private readonly enabled: boolean,
    private readonly monotonic: () => bigint = () => process.hrtime.bigint(),
  ) {}

  capture(phase: string, force = false): void {
    if (!this.enabled) return;
    const at = this.monotonic();
    if (this.lastAt !== undefined) {
      if (at <= this.lastAt) return;
      if (!force && phase === this.lastPhase && Number(at - this.lastAt) / 1e6 < this.intervalMs)
        return;
    }
    this.lastAt = at;
    this.lastPhase = phase;
    if (this.samples.length >= this.limit) {
      this.droppedSamples++;
      return;
    }
    const snapshot = this.reader.snapshot();
    this.samples.push({
      atNs: at.toString(),
      phase,
      collectionMs: Number(this.monotonic() - at) / 1e6,
      snapshot,
    });
  }

  report() {
    return {
      intervalMs: this.intervalMs,
      limit: this.limit,
      droppedSamples: this.droppedSamples,
      samples: this.samples,
      windows: this.samples
        .slice(1)
        .map((after, index) => diagnosticsWindow(this.samples[index]!, after)),
    };
  }
}
