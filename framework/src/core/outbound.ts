import type { OutboundOptions, QueueSnapshot } from '../contracts.js';
import { errorOf, FrameworkError } from './errors.js';
import { bounded } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import type { Diagnostics, Observation } from '../diagnostics/observer.js';
import { integer, keys } from './config-validation.js';

export function outboundSettings(input: OutboundOptions = {}): Required<OutboundOptions> {
  keys(input, ['concurrency', 'queueCapacity', 'queueMaxBytes'], 'outbound');
  return Object.freeze({
    concurrency: integer(input.concurrency, 8, 'outbound.concurrency'),
    queueCapacity: integer(input.queueCapacity, 1000, 'outbound.queueCapacity'),
    queueMaxBytes: integer(input.queueMaxBytes, 16777216, 'outbound.queueMaxBytes'),
  });
}
interface Job {
  account: string | symbol;
  bytes: number;
  enqueuedAt: number;
  controller: AbortController;
  start(): void;
  cancel(): void;
  running: boolean;
  finished: boolean;
  previous: Job | undefined;
  next: Job | undefined;
}
interface PendingJobs {
  first: Job | undefined;
  last: Job | undefined;
}
/** Round-robin across accounts; admission and snapshot ownership happen before any await. */
export class OutboundQueue {
  private readonly waiting = new Map<string | symbol, PendingJobs>();
  private readonly jobs = new Set<Job>();
  private readonly accountJobs = new Map<string | symbol, number>();
  private readonly changed = new Set<() => void>();
  private active = 0;
  private pending = 0;
  private bytes = 0;
  private pumping = false;
  private lastAccount?: string | symbol;
  private closed = false;
  private readonly counts = { accepted: 0, completed: 0, failed: 0, rejected: 0 };
  private readonly rejections = { queueFull: 0, bytesFull: 0, stopping: 0 };
  private readonly queueWait = { count: 0, totalMs: 0, maxMs: 0 };
  constructor(
    readonly settings: Required<OutboundOptions>,
    private readonly clock: Clock = systemClock,
    private readonly observer?: Diagnostics,
    private readonly channel: 'outbound' | 'control' = 'outbound',
  ) {}
  run<T>(
    account: string | symbol,
    bytes: number,
    operation: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let result: Promise<T>;
    const context = this.observer
      ? {
          ...(this.observer.context(signal) ?? this.observer.root()),
        }
      : undefined;
    if (context) {
      if (typeof account === 'string') context.appId = account;
      else delete context.appId;
    }
    const waiting = this.observer?.start(`${this.channel}.queue`, context, signal);
    let running: Observation | undefined;
    try {
      signal?.throwIfAborted();
      const reason = this.closed
        ? 'stopping'
        : this.active + this.pending >= this.settings.concurrency + this.settings.queueCapacity
          ? 'queueFull'
          : this.bytes + bytes > this.settings.queueMaxBytes
            ? 'bytesFull'
            : undefined;
      if (reason) {
        waiting?.end(reason === 'stopping' ? 'cancelled' : 'rejected');
        this.counts.rejected++;
        this.rejections[reason]++;
        throw new FrameworkError(
          reason === 'stopping'
            ? 'INVALID_STATE'
            : reason === 'queueFull'
              ? 'QUEUE_FULL'
              : 'RESOURCE_LIMIT',
          `Outbound admission rejected: ${reason}`,
        );
      }
      const controller = new AbortController();
      this.observer?.bind(controller.signal, waiting?.context ?? context);
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener('abort', cancel, { once: true });
      let resolve!: (value: T) => void;
      let reject!: (error: unknown) => void;
      result = new Promise<T>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      const finish = (ok: boolean, value: unknown) => {
        if (job.finished) return;
        job.finished = true;
        if (ok) {
          waiting?.end();
          running?.end();
        } else {
          waiting?.fail(value, controller.signal);
          running?.fail(value, controller.signal);
        }
        this.observer?.unbind(controller.signal);
        signal?.removeEventListener('abort', cancel);
        controller.signal.removeEventListener('abort', aborted);
        if (job.running) this.active--;
        else {
          this.pending--;
          this.unlink(job);
        }
        this.bytes -= bytes;
        this.jobs.delete(job);
        const remaining = (this.accountJobs.get(account) ?? 1) - 1;
        if (remaining) this.accountJobs.set(account, remaining);
        else this.accountJobs.delete(account);
        if (ok) {
          this.counts.completed++;
          resolve(value as T);
        } else {
          this.counts.failed++;
          reject(value);
        }
        this.pump();
        for (const changed of [...this.changed]) changed();
      };
      const aborted = () => {
        if (!job.running) finish(false, controller.signal.reason);
      };
      const job: Job = {
        account,
        bytes,
        controller,
        running: false,
        finished: false,
        previous: undefined,
        next: undefined,
        enqueuedAt: this.clock.monotonic(),
        cancel: () =>
          controller.abort(new FrameworkError('INVALID_STATE', 'Sending account stopped')),
        start: () => {
          waiting?.end();
          running = this.observer?.start(`${this.channel}.run`, context, controller.signal);
          this.observer?.bind(controller.signal, running?.context ?? context);
          job.running = true;
          this.active++;
          this.pending--;
          const duration = this.clock.monotonic() - job.enqueuedAt;
          this.queueWait.count++;
          this.queueWait.totalMs += duration;
          this.queueWait.maxMs = Math.max(this.queueWait.maxMs, duration);
          bounded(
            Promise.resolve().then(() => {
              controller.signal.throwIfAborted();
              return operation(controller.signal);
            }),
            Infinity,
            controller.signal,
            this.clock,
          ).then(
            (value) => finish(true, value),
            (error: unknown) => finish(false, error),
          );
        },
      };
      this.jobs.add(job);
      this.accountJobs.set(account, (this.accountJobs.get(account) ?? 0) + 1);
      this.pending++;
      this.bytes += bytes;
      this.counts.accepted++;
      const list = this.waiting.get(account) ?? { first: undefined, last: undefined };
      job.previous = list.last;
      if (list.last) list.last.next = job;
      else list.first = job;
      list.last = job;
      this.waiting.set(account, list);
      controller.signal.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) cancel();
      this.pump();
    } catch (error) {
      waiting?.fail(error, signal);
      running?.fail(error, signal);
      result = Promise.reject(errorOf(error));
    }
    // Background callers may intentionally fire and forget; resource tracking still owns completion.
    result.catch(() => {});
    return result;
  }
  /** Unlink immediately on cancellation: neither closures nor image snapshots remain in a pending array. */
  private unlink(job: Job): void {
    const list = this.waiting.get(job.account)!;
    if (job.previous) job.previous.next = job.next;
    else list.first = job.next;
    if (job.next) job.next.previous = job.previous;
    else list.last = job.previous;
    job.previous = undefined;
    job.next = undefined;
    if (!list.first) this.waiting.delete(job.account);
  }
  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (!this.closed && this.active < this.settings.concurrency && this.pending) {
        const accounts = this.waiting.keys();
        let account = accounts.next().value;
        if (account === this.lastAccount && this.waiting.size > 1) account = accounts.next().value;
        if (account === undefined) break;
        const list = this.waiting.get(account)!;
        const job = list.first!;
        this.unlink(job);
        // Rotate a nonempty account to the end without scanning every account or shifting its jobs.
        if (list.first) {
          this.waiting.delete(account);
          this.waiting.set(account, list);
        }
        this.lastAccount = account;
        job.start();
      }
    } finally {
      this.pumping = false;
    }
  }
  abortAccount(account: string): void {
    for (const job of [...this.jobs]) if (job.account === account) job.cancel();
  }
  async idle(deadline = Infinity, account?: string): Promise<void> {
    const pending = () =>
      account === undefined ? this.jobs.size > 0 : this.accountJobs.has(account);
    if (!pending()) return;
    let check!: () => void;
    const wait = new Promise<void>((resolve) => {
      check = () => {
        if (!pending()) resolve();
      };
      this.changed.add(check);
      check();
    });
    try {
      await bounded(wait, deadline, undefined, this.clock);
    } finally {
      this.changed.delete(check);
    }
  }
  close(): void {
    this.closed = true;
    for (const job of [...this.jobs]) job.cancel();
  }
  snapshot(): QueueSnapshot {
    return Object.freeze({
      active: this.active,
      pending: this.pending,
      retainedBytes: this.bytes,
      ...this.settings,
      ...this.counts,
      rejections: Object.freeze({ ...this.rejections }),
      queueWait: Object.freeze({ ...this.queueWait }),
    });
  }
}
