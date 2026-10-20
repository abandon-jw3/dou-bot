import { randomUUID } from 'node:crypto';
import type {
  DiagnosticsMetric,
  DiagnosticsOptions,
  DiagnosticsOutcome,
  DiagnosticsReader,
  DiagnosticsSnapshot,
  DiagnosticsSpan,
  DiagnosticsStage,
  DiagnosticsOperation,
} from './contracts.js';
import type { Clock, Timer } from '../core/clock.js';
import { errorOf, FrameworkError } from '../core/errors.js';
import { integer, keys } from '../core/config-validation.js';
import { bounded } from '../core/utils.js';

const upperBounds = Object.freeze([
  0, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000,
]);
const outcomes = (): Record<DiagnosticsOutcome, number> => ({
  success: 0,
  error: 0,
  timeout: 0,
  cancelled: 0,
  rejected: 0,
  ignored: 0,
  duplicate: 0,
  'cache-hit': 0,
});
export function diagnosticsSettings(input: DiagnosticsOptions = {}) {
  keys(
    input,
    [
      'enabled',
      'traceSampleRate',
      'maxSeries',
      'maxActiveSpans',
      'maxPendingSpans',
      'onSpans',
      'exportIntervalMs',
      'exportTimeoutMs',
    ],
    'diagnostics',
  );
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean')
    throw new FrameworkError('CONFIG', 'diagnostics.enabled must be boolean');
  const rate = input.traceSampleRate ?? 0;
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new FrameworkError('CONFIG', 'diagnostics.traceSampleRate must be in [0, 1]');
  if (input.onSpans !== undefined && typeof input.onSpans !== 'function')
    throw new FrameworkError('CONFIG', 'diagnostics.onSpans must be callable');
  return Object.freeze({
    enabled: input.enabled ?? false,
    traceSampleRate: rate,
    maxSeries: integer(input.maxSeries, 2048, 'diagnostics.maxSeries', 1, 65536),
    maxActiveSpans: integer(input.maxActiveSpans, 4096, 'diagnostics.maxActiveSpans', 1, 65536),
    maxPendingSpans: integer(input.maxPendingSpans, 2048, 'diagnostics.maxPendingSpans', 1, 65536),
    onSpans: input.onSpans as DiagnosticsOptions['onSpans'],
    exportIntervalMs: integer(input.exportIntervalMs, 1000, 'diagnostics.exportIntervalMs'),
    exportTimeoutMs: integer(input.exportTimeoutMs, 1000, 'diagnostics.exportTimeoutMs'),
  });
}
export type DiagnosticsSettings = ReturnType<typeof diagnosticsSettings>;

/** Internal correlation is explicitly passed or associated with framework-owned signals. */
export interface ObservationContext {
  appId?: string;
  handler?: string;
  component?: number;
  operation?: DiagnosticsOperation;
  traceId?: string;
  parentSpanId?: number;
}
interface Series {
  stage: DiagnosticsStage;
  labels: Pick<ObservationContext, 'appId' | 'handler' | 'component' | 'operation'>;
  count: number;
  totalMs: number;
  maxMs: number;
  outcomes: Record<DiagnosticsOutcome, number>;
  buckets: number[];
  active: Set<Observation>;
}
interface SignalWatch {
  spans: Set<Observation>;
  abort: () => void;
}
export function diagnosticOutcome(error: unknown, signal?: AbortSignal): DiagnosticsOutcome {
  try {
    if (
      error instanceof FrameworkError &&
      typeof error.code === 'string' &&
      error.code.endsWith('TIMEOUT')
    )
      return 'timeout';
  } catch {
    /* User-thrown objects cannot break diagnostic error classification. */
  }
  return signal?.aborted ? 'cancelled' : 'error';
}

export class Observation {
  readonly started: number;
  readonly context: ObservationContext;
  readonly spanId: number | undefined;
  private ended = false;
  constructor(
    private readonly owner: Diagnostics,
    readonly series: Series,
    context: ObservationContext,
    readonly signal?: AbortSignal,
  ) {
    this.started = owner.clock.monotonic();
    this.spanId = context.traceId === undefined ? undefined : owner.nextSpanId();
    this.context = this.spanId === undefined ? context : { ...context, parentSpanId: this.spanId };
    this.parentSpanId = context.parentSpanId;
  }
  readonly parentSpanId: number | undefined;
  end(outcome: DiagnosticsOutcome = 'success'): void {
    if (this.ended) return;
    this.ended = true;
    this.owner.finish(this, outcome);
  }
  fail(error: unknown, signal = this.signal): void {
    this.end(diagnosticOutcome(error, signal));
  }
}

const emptySnapshot: DiagnosticsSnapshot = Object.freeze({
  enabled: false,
  closed: false,
  elapsedMs: 0,
  bucketUpperBoundsMs: upperBounds,
  metrics: Object.freeze([]),
  activeSpans: 0,
  bufferedSpans: 0,
  exportingSpans: 0,
  droppedMeasurements: 0,
  droppedSpans: 0,
  exportFailures: 0,
  exportDisabled: false,
});
const emptySpans: readonly DiagnosticsSpan[] = Object.freeze([]);
const closedEmptySnapshot = Object.freeze({ ...emptySnapshot, closed: true });
export function disabledDiagnostics(state: Readonly<{ closed: boolean }>): DiagnosticsReader {
  return Object.freeze({
    snapshot: () => (state.closed ? closedEmptySnapshot : emptySnapshot),
    takeSpans: () => emptySpans,
  });
}

/** Application-owned, bounded recorder. No payloads, stack traces, timers or promises on the disabled path. */
export class Diagnostics {
  readonly reader: DiagnosticsReader;
  private exporter: DiagnosticsOptions['onSpans'];
  private readonly series = new Map<string, Series>();
  private readonly active = new Set<Observation>();
  private readonly contexts = new WeakMap<AbortSignal, ObservationContext>();
  private readonly watches = new WeakMap<AbortSignal, SignalWatch>();
  private readonly started: number;
  private readonly prefix: string;
  private sequence = 0;
  private rootSequence = 0;
  private buffer: DiagnosticsSpan[] = [];
  private timer: Timer | undefined;
  private exporting = 0;
  private exportTask: Promise<void> | undefined;
  private exportController: AbortController | undefined;
  private closed = false;
  private closedAt: number | undefined;
  private exportDisabled = false;
  private droppedMeasurements = 0;
  private droppedSpans = 0;
  private exportFailures = 0;
  constructor(
    readonly settings: DiagnosticsSettings,
    readonly clock: Clock,
    private readonly random: () => number = Math.random,
    private readonly accounts?: ReadonlySet<string>,
  ) {
    this.exporter = settings.onSpans;
    // Readers may outlive an application. Retain numeric limits, not the user's
    // exporter closure (which can itself capture the entire application).
    this.settings = Object.freeze({ ...settings, onSpans: undefined });
    this.started = clock.monotonic();
    this.prefix = settings.traceSampleRate > 0 ? randomUUID() : '';
    this.reader = Object.freeze({
      snapshot: () => this.snapshot(),
      takeSpans: () => this.takeSpans(),
    });
  }
  root(appId?: string): ObservationContext {
    if (appId !== undefined && this.accounts && !this.accounts.has(appId)) appId = undefined;
    const sample = this.settings.traceSampleRate;
    return {
      ...(appId === undefined ? {} : { appId }),
      ...(sample > 0 && (sample === 1 || this.random() < sample)
        ? { traceId: `${this.prefix}:${++this.rootSequence}` }
        : {}),
    };
  }
  context(signal: AbortSignal | undefined): ObservationContext | undefined {
    return signal === undefined ? undefined : this.contexts.get(signal);
  }
  bind(signal: AbortSignal, context: ObservationContext | undefined): void {
    if (!this.closed && context) this.contexts.set(signal, context);
  }
  inherit(from: AbortSignal | undefined, to: AbortSignal): void {
    this.bind(to, this.context(from));
  }
  unbind(signal: AbortSignal): void {
    this.contexts.delete(signal);
  }
  nextSpanId(): number {
    return ++this.sequence;
  }
  start(
    stage: DiagnosticsStage,
    context: ObservationContext = {},
    signal?: AbortSignal,
  ): Observation | undefined {
    if (this.closed) return;
    if (context.appId !== undefined && this.accounts && !this.accounts.has(context.appId)) {
      const { appId: _unknown, ...known } = context;
      void _unknown;
      context = known;
    }
    if (this.active.size >= this.settings.maxActiveSpans) {
      this.droppedMeasurements++;
      if (context.traceId) this.droppedSpans++;
      return;
    }
    const key = JSON.stringify([
      stage,
      context.appId,
      context.handler,
      context.component,
      context.operation,
    ]);
    let series = this.series.get(key);
    if (!series) {
      if (this.series.size >= this.settings.maxSeries) {
        this.droppedMeasurements++;
        if (context.traceId) this.droppedSpans++;
        return;
      }
      series = {
        stage,
        labels: {
          ...(context.appId === undefined ? {} : { appId: context.appId }),
          ...(context.handler === undefined ? {} : { handler: context.handler.slice(0, 256) }),
          ...(context.component === undefined ? {} : { component: context.component }),
          ...(context.operation === undefined ? {} : { operation: context.operation }),
        },
        count: 0,
        totalMs: 0,
        maxMs: 0,
        outcomes: outcomes(),
        buckets: Array<number>(upperBounds.length + 1).fill(0),
        active: new Set(),
      };
      this.series.set(key, series);
    }
    const span = new Observation(this, series, context, signal);
    this.active.add(span);
    series.active.add(span);
    if (signal) {
      if (signal.aborted) span.fail(signal.reason, signal);
      else {
        let watch = this.watches.get(signal);
        if (!watch) {
          const spans = new Set<Observation>();
          watch = {
            spans,
            abort: () => {
              for (const item of spans) item.fail(signal.reason, signal);
            },
          };
          this.watches.set(signal, watch);
          signal.addEventListener('abort', watch.abort, { once: true });
        }
        watch.spans.add(span);
      }
    }
    return span;
  }
  finish(span: Observation, outcome: DiagnosticsOutcome): void {
    const durationMs = Math.max(0, this.clock.monotonic() - span.started);
    this.active.delete(span);
    const series = span.series;
    series.active.delete(span);
    if (span.signal) {
      const watch = this.watches.get(span.signal);
      watch?.spans.delete(span);
      if (watch?.spans.size === 0) {
        span.signal.removeEventListener('abort', watch.abort);
        this.watches.delete(span.signal);
      }
    }
    series.count++;
    series.totalMs += durationMs;
    series.maxMs = Math.max(series.maxMs, durationMs);
    series.outcomes[outcome]++;
    let bin = 0;
    while (bin < upperBounds.length && durationMs > upperBounds[bin]!) bin++;
    series.buckets[bin]!++;
    if (span.spanId === undefined || span.context.traceId === undefined) return;
    if (this.buffer.length + this.exporting >= this.settings.maxPendingSpans) {
      this.droppedSpans++;
      return;
    }
    this.buffer.push(
      Object.freeze({
        ...series.labels,
        traceId: span.context.traceId,
        spanId: span.spanId,
        ...(span.parentSpanId === undefined ? {} : { parentSpanId: span.parentSpanId }),
        stage: series.stage,
        startedMs: Math.max(0, span.started - this.started),
        durationMs,
        outcome,
      }),
    );
    this.schedule();
  }
  private snapshot(): DiagnosticsSnapshot {
    const now = this.closedAt ?? this.clock.monotonic();
    const metrics = [...this.series.values()].map((series): DiagnosticsMetric => {
      const percentile = (fraction: number): number | null => {
        if (!series.count) return null;
        const target = Math.ceil(series.count * fraction);
        let count = 0;
        for (let index = 0; index < series.buckets.length; index++) {
          count += series.buckets[index]!;
          if (count >= target) return upperBounds[index] ?? null;
        }
        return null;
      };
      const first = series.active.values().next().value;
      return Object.freeze({
        ...series.labels,
        stage: series.stage,
        count: series.count,
        totalMs: series.totalMs,
        maxMs: series.maxMs,
        active: series.active.size,
        oldestActiveMs: first ? Math.max(0, now - first.started) : 0,
        outcomes: Object.freeze({ ...series.outcomes }),
        buckets: Object.freeze([...series.buckets]),
        p50UpperMs: percentile(0.5),
        p95UpperMs: percentile(0.95),
        p99UpperMs: percentile(0.99),
      });
    });
    return Object.freeze({
      enabled: true,
      closed: this.closed,
      elapsedMs: Math.max(0, now - this.started),
      bucketUpperBoundsMs: upperBounds,
      metrics: Object.freeze(metrics),
      activeSpans: this.active.size,
      bufferedSpans: this.buffer.length,
      exportingSpans: this.exporting,
      droppedMeasurements: this.droppedMeasurements,
      droppedSpans: this.droppedSpans,
      exportFailures: this.exportFailures,
      exportDisabled: this.exportDisabled,
    });
  }
  private takeSpans(): readonly DiagnosticsSpan[] {
    const spans = this.buffer;
    this.buffer = [];
    return Object.freeze(spans);
  }
  private schedule(): void {
    if (this.closed || this.exportDisabled || !this.exporter || this.timer || this.exportTask)
      return;
    this.timer = this.clock.timeout(() => {
      this.timer = undefined;
      this.flush().catch(() => {
        this.exportFailures++;
        this.exportDisabled = true;
      });
    }, this.settings.exportIntervalMs);
    this.timer.unref();
  }
  private flush(deadline = this.clock.monotonic() + this.settings.exportTimeoutMs): Promise<void> {
    if (this.exportTask) return this.exportTask;
    if (
      !this.exporter ||
      this.exportDisabled ||
      !this.buffer.length ||
      this.clock.monotonic() >= deadline
    )
      return Promise.resolve();
    const spans = this.takeSpans();
    const controller = new AbortController();
    this.exportController = controller;
    this.exporting = spans.length;
    const exporter = this.exporter;
    const pending = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return exporter(spans, controller.signal);
    });
    // A timed-out consumer may ignore cancellation and retain its batch. Keep that
    // batch charged until the consumer actually settles; never start a second one.
    const release = () => {
      this.exporting = 0;
    };
    pending.then(release, release);
    const task = bounded(pending, deadline, controller.signal, this.clock)
      .then((value) => {
        if (value !== undefined)
          throw new FrameworkError('HANDLER_CONTRACT', 'Diagnostics exporter must return void');
      })
      .catch((error: unknown) => {
        if (!(this.closed && controller.signal.aborted)) this.exportFailures++;
        this.exportDisabled = true;
        this.droppedSpans += spans.length;
        controller.abort(errorOf(error));
      })
      .finally(() => {
        controller.abort(new FrameworkError('INVALID_STATE', 'Diagnostics export ended'));
        this.exportController = undefined;
        this.exportTask = undefined;
        if (this.buffer.length) this.schedule();
      });
    this.exportTask = task;
    return task;
  }
  async close(deadline: number): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.timer?.cancel();
    this.timer = undefined;
    for (const span of this.active) span.end('cancelled');
    this.closedAt = this.clock.monotonic();
    if (this.exportTask) {
      this.exportController?.abort(new FrameworkError('INVALID_STATE', 'Diagnostics closing'));
      await this.exportTask;
    }
    await this.flush(Math.min(deadline, this.clock.monotonic() + this.settings.exportTimeoutMs));
    this.exporter = undefined;
  }
}
