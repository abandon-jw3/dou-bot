import type { Awaitable } from '../contracts.js';

/** Stable framework boundaries. Durations are wall time, not CPU time. */
export type DiagnosticsStage =
  | 'webhook.request'
  | 'webhook.body'
  | 'webhook.parse'
  | 'webhook.verify'
  | 'webhook.verify.wait'
  | 'ws.parse'
  | 'event.admission'
  | 'event.normalize'
  | 'event.queue'
  | 'event.run'
  | 'event.total'
  | 'event.drain'
  | 'handler.total'
  | 'handler.middleware'
  | 'handler.guard'
  | 'handler.bind'
  | 'handler.context'
  | 'handler.cooldown'
  | 'handler.invoke'
  | 'handler.observer'
  | 'context.load'
  | 'context.lookup'
  | 'reply.wait'
  | 'message.prepare'
  | 'outbound.queue'
  | 'outbound.run'
  | 'control.queue'
  | 'control.run'
  | 'qq.token.wait'
  | 'qq.token.refresh'
  | 'qq.http'
  | 'qq.http.headers'
  | 'qq.http.body'
  | 'route.learn'
  | 'route.lookup'
  | 'prompt.wait'
  | 'cache.prune';

export type DiagnosticsOutcome =
  | 'success'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'rejected'
  | 'ignored'
  | 'duplicate'
  | 'cache-hit';

export type DiagnosticsOperation =
  'message' | 'upload' | 'interaction' | 'token' | 'gateway' | 'other';

export interface DiagnosticsOptions {
  /** Defaults to false. Existing application snapshots remain available when disabled. */
  enabled?: boolean;
  /** Probability of sampling an entire incoming event or background operation; default 0. */
  traceSampleRate?: number;
  /** Maximum distinct stage/account/handler/component combinations; default 2048. */
  maxSeries?: number;
  /** Maximum simultaneously tracked stage intervals; default 4096. */
  maxActiveSpans?: number;
  /** Maximum buffered plus currently exported sampled spans; default 2048. */
  maxPendingSpans?: number;
  /** Optional asynchronous batch consumer. Failures disable automatic export and are counted. */
  onSpans?: (spans: readonly DiagnosticsSpan[], signal: AbortSignal) => Awaitable<void>;
  /** Batch export interval; default 1000 ms. No periodic work without onSpans. */
  exportIntervalMs?: number;
  /** Maximum wait for a batch consumer; default 1000 ms. */
  exportTimeoutMs?: number;
}

export interface DiagnosticsMetric {
  readonly stage: DiagnosticsStage;
  readonly appId?: string;
  /** Registered controller/method, never command input or a user identifier. */
  readonly handler?: string;
  /** Zero-based middleware/guard position in this handler's resolved declaration order. */
  readonly component?: number;
  /** Fixed QQ API family; URLs and identifiers are never retained. */
  readonly operation?: DiagnosticsOperation;
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly active: number;
  readonly oldestActiveMs: number;
  readonly outcomes: Readonly<Record<DiagnosticsOutcome, number>>;
  /** Noncumulative bins. Last bin is overflow beyond the snapshot's finite upper bounds. */
  readonly buckets: readonly number[];
  /** Approximate upper bounds; null for no samples or a quantile in the overflow bin. */
  readonly p50UpperMs: number | null;
  readonly p95UpperMs: number | null;
  readonly p99UpperMs: number | null;
}

export interface DiagnosticsSpan {
  /** Opaque local correlation identifiers, unrelated to QQ event/user/group identifiers. */
  readonly traceId: string;
  readonly spanId: number;
  readonly parentSpanId?: number;
  readonly stage: DiagnosticsStage;
  readonly appId?: string;
  readonly handler?: string;
  readonly component?: number;
  readonly operation?: DiagnosticsOperation;
  readonly startedMs: number;
  readonly durationMs: number;
  readonly outcome: DiagnosticsOutcome;
}

export interface DiagnosticsSnapshot {
  readonly enabled: boolean;
  readonly closed: boolean;
  readonly elapsedMs: number;
  readonly bucketUpperBoundsMs: readonly number[];
  readonly metrics: readonly DiagnosticsMetric[];
  readonly activeSpans: number;
  readonly bufferedSpans: number;
  readonly exportingSpans: number;
  readonly droppedMeasurements: number;
  readonly droppedSpans: number;
  readonly exportFailures: number;
  readonly exportDisabled: boolean;
}

export interface DiagnosticsReader {
  /** Cumulative metrics since application construction; does not reset counters. */
  snapshot(): DiagnosticsSnapshot;
  /** Consume queued sampled records. Records already in an export batch are excluded. */
  takeSpans(): readonly DiagnosticsSpan[];
}
