import type { ManagedQQClient } from '../qq/managed-client.js';
import type { ExecutionPool } from './execution-pool.js';
import type { BotSnapshot, MessageInput, PromptOptions, PromptResult } from '../contracts.js';
import type { ResolvedOptions } from './config.js';
import type { ErrorReporter } from './logging.js';
import type { NormalizedEvent } from '../qq/normalize.js';
import { normalize, isDispatch } from '../qq/normalize.js';
import { errorOf, FrameworkError } from './errors.js';
import { targetKey } from '../message/index.js';
import { bounded } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { PromptManager } from './prompts.js';
import { EventTask } from './event-task.js';
import type { HandlerLocation, MessageBinding, ReplyScope } from './event-task.js';

export type Admission =
  | { status: 'accepted' | 'duplicate'; done: Promise<void> }
  | { status: 'ignored' | 'overloaded' | 'stopping' | 'failed' };
interface DedupEntry {
  active: boolean;
  expiresAt: number;
  done: Promise<void>;
}
interface QueuedTask {
  task: EventTask;
  bytes: number;
  entry?: DedupEntry;
  key?: string;
  scope?: ReplyScope;
  scopeKey?: string;
  resolve(): void;
  started: boolean;
  running: boolean;
  runningSince: number;
  processingMs: number;
  children: Set<QueuedTask>;
  finished: boolean;
}
interface QueueItem {
  queued: QueuedTask;
  enqueuedAt: number;
  resume?: () => void;
}

export class Execution {
  readonly managedSignals = new Set<AbortSignal>();
  readonly events = { accepted: 0, duplicates: 0, rejected: 0, failed: 0 };
  private readonly dedup = new Map<string, DedupEntry>();
  private readonly scopes = new Map<string, ReplyScope>();
  // TTLs are fixed per cache and the clock is monotonic. Completion/release order
  // is therefore expiry order. Active entries never occur in these indexes.
  private readonly idleDedup = new Map<string, DedupEntry>();
  private readonly idleScopes = new Map<string, ReplyScope>();
  private readonly rejections: BotSnapshot['rejections'] = {
    invalidEvent: 0,
    queueFull: 0,
    bytesFull: 0,
    acknowledgmentsFull: 0,
    replyScopesFull: 0,
    dedupFull: 0,
  };
  private readonly timing: BotSnapshot['timing'] = {
    queueWait: { count: 0, totalMs: 0, maxMs: 0 },
    processing: { count: 0, totalMs: 0, maxMs: 0 },
  };
  private readonly waiting: (QueueItem | undefined)[] = [];
  private readonly prompts: PromptManager<QueuedTask, QueuedTask>;
  private head = 0;
  private readonly tasks = new Set<QueuedTask>();
  private readonly changed = new Set<() => void>();
  private accepting = false;
  private terminated = false;
  private active = 0;
  private controls = 0;
  private nextExpiry = Infinity;
  private retainedBytes = 0;
  lastEventAt: number | undefined;
  private unregister: (() => void) | undefined;

  constructor(
    private readonly options: ResolvedOptions,
    private readonly client: ManagedQQClient,
    private readonly reporter: ErrorReporter,
    private readonly execute: (task: EventTask) => Promise<void>,
    private readonly handles: (event: NormalizedEvent) => boolean | 'observe' = () => true,
    private readonly clock: Clock = systemClock,
    private readonly pool?: ExecutionPool,
  ) {
    this.unregister = pool?.register({ pending: () => this.pending, step: () => this.pumpOne() });
    this.prompts = new PromptManager(options.prompts, clock, {
      suspend: (owner) => {
        if (owner.finished || !owner.running)
          throw new FrameworkError('INVALID_STATE', 'Prompt owner is not executing');
        this.stopRunning(owner);
        this.notify();
        this.pump();
      },
      resume: (owner, continuation) => {
        if (owner.finished || this.terminated) {
          continuation();
          return;
        }
        this.pool?.enqueued();
        this.waiting.push({
          queued: owner,
          enqueuedAt: this.clock.monotonic(),
          resume: continuation,
        });
        this.pump();
      },
      abort: (owner, reason) => owner.task.controller.abort(reason),
      fallback: (input) => this.fallback(input),
    });
  }
  start(): void {
    this.accepting = true;
  }
  stopAccepting(): void {
    this.accepting = false;
    this.prompts.close(new FrameworkError('INVALID_STATE', 'Application is stopping'));
    this.notify();
  }
  get pending(): number {
    return this.waiting.length - this.head;
  }
  snapshot(): { pending: number; active: number; retainedBytes: number } {
    return { pending: this.pending, active: this.active, retainedBytes: this.retainedBytes };
  }
  promptSnapshot(): { pending: number } {
    return { pending: this.prompts.size };
  }
  metrics(): Pick<BotSnapshot, 'capacity' | 'rejections' | 'timing'> {
    this.prune(this.clock.monotonic());
    const config = this.options.execution;
    return {
      capacity: {
        concurrency: config.concurrency,
        queueCapacity: config.queueCapacity,
        queueMaxBytes: config.queueMaxBytes,
        dedup: { size: this.dedup.size, limit: config.dedupMaxEntries },
        replyScopes: { size: this.scopes.size, limit: config.replyScopeMaxEntries },
      },
      rejections: { ...this.rejections },
      timing: {
        queueWait: { ...this.timing.queueWait },
        processing: { ...this.timing.processing },
      },
    };
  }
  private reject(reason: keyof BotSnapshot['rejections']): void {
    this.events.rejected++;
    this.rejections[reason]++;
  }
  private observe(metric: keyof BotSnapshot['timing'], milliseconds: number): void {
    const value = this.timing[metric];
    value.count++;
    value.totalMs += milliseconds;
    value.maxMs = Math.max(value.maxMs, milliseconds);
  }
  private stopRunning(queued: QueuedTask): void {
    if (!queued.running) return;
    queued.processingMs += this.clock.monotonic() - queued.runningSince;
    queued.running = false;
    this.active--;
    this.pool?.leave();
  }

  private promptKey(event: Extract<NormalizedEvent, { kind: 'message' }>): string {
    return JSON.stringify([this.options.appId, targetKey(event.target), event.userId]);
  }
  private ask(
    owner: QueuedTask,
    actor: EventTask,
    source: MessageBinding,
    question: MessageInput,
    options: PromptOptions,
    location?: HandlerLocation,
  ): Promise<PromptResult> {
    if (!this.accepting || owner.finished || !owner.running || !actor.ledger.open)
      throw new FrameworkError('INVALID_STATE', 'Prompt requires a running message handler');
    return this.prompts.request(
      owner,
      this.promptKey(source.event),
      actor.controller.signal,
      () => {
        actor.manualReplies++;
        return actor.send(question, true, location, source);
      },
      (input) => {
        if (owner.finished || input.finished || input.task.event.kind !== 'message' || !input.scope)
          throw new FrameworkError('INVALID_STATE', 'Prompt message context has finished');
        owner.children.add(input);
        return actor.messageContext(location, { event: input.task.event, scope: input.scope });
      },
      options,
    );
  }
  private fallback(input: QueuedTask): void {
    if (input.finished) return;
    if (!this.accepting || this.terminated || !this.handles(input.task.event)) {
      this.finish(input);
      return;
    }
    // Captured input has already reserved bytes, a dedup entry and a reply scope.
    // Requeue that same task, rather than re-admit it as a duplicate or lose the input.
    this.pool?.enqueued();
    this.waiting.push({ queued: input, enqueuedAt: this.clock.monotonic() });
    this.pump();
  }

  accept(payload: unknown, bytes: number): Admission {
    if (!this.accepting || this.terminated) return { status: 'stopping' };
    const config = this.options.execution;
    if (
      !Number.isSafeInteger(bytes) ||
      bytes <= 0 ||
      bytes > config.maxEventBytes ||
      !isDispatch(payload)
    ) {
      this.reject('invalidEvent');
      return { status: 'ignored' };
    }
    try {
      const parsed = normalize(payload, this.clock.wallTime());
      if (parsed.status === 'invalid') {
        this.reject('invalidEvent');
        this.reporter.report(new FrameworkError('PROTOCOL', parsed.reason), {
          phase: 'protocol',
          appId: this.options.appId,
          eventName: payload.t,
        });
        return { status: 'ignored' };
      }
      const event = parsed.event;
      if (parsed.conflictingFields?.length)
        this.reporter.logger.debug('QQ identity aliases differ; preferred fields were used', {
          eventName: payload.t,
          fields: parsed.conflictingFields,
        });
      const now = this.clock.monotonic();
      this.prune(now);
      const key =
        event.kind === 'message'
          ? JSON.stringify([
              this.options.appId,
              'message',
              targetKey(event.target),
              event.messageId,
              event.sourceIndex,
            ])
          : event.kind === 'button'
            ? JSON.stringify([this.options.appId, 'button', event.interactionId])
            : event.raw.id
              ? JSON.stringify([this.options.appId, event.raw.t, event.raw.id])
              : undefined;
      const existing = key === undefined ? undefined : this.dedup.get(key);
      if (existing) {
        this.events.duplicates++;
        return { status: 'duplicate', done: existing.done };
      }
      const prompt =
        event.kind === 'message' ? this.prompts.find(this.promptKey(event)) : undefined;
      const handling = this.handles(event);
      const observationOnly = !prompt && handling === 'observe' && event.kind !== 'button';
      if (!prompt && !handling && !(event.kind === 'button' && this.options.acknowledge === 'auto'))
        return { status: 'ignored' };
      const scopeKey =
        event.kind === 'message'
          ? JSON.stringify([this.options.appId, targetKey(event.target), event.messageId])
          : undefined;
      let scope = scopeKey === undefined ? undefined : this.scopes.get(scopeKey);
      const autoAck = event.kind === 'button' && this.options.acknowledge === 'auto';
      const rejection =
        this.pool?.rejection(bytes, Boolean(prompt)) ??
        (!this.pool &&
        !prompt &&
        this.pending + this.active >= config.queueCapacity + config.concurrency
          ? 'queueFull'
          : !this.pool && this.retainedBytes + bytes > config.queueMaxBytes
            ? 'bytesFull'
            : autoAck && this.controls >= config.concurrency
              ? 'acknowledgmentsFull'
              : scopeKey !== undefined && !scope && this.scopes.size >= config.replyScopeMaxEntries
                ? 'replyScopesFull'
                : undefined);
      if (rejection) {
        this.reject(rejection);
        return { status: 'overloaded' };
      }
      if (key !== undefined && this.dedup.size >= config.dedupMaxEntries) {
        const expiredCandidate = this.idleDedup.keys().next().value;
        if (expiredCandidate === undefined) {
          this.reject('dedupFull');
          return { status: 'overloaded' };
        }
        this.dedup.delete(expiredCandidate);
        this.idleDedup.delete(expiredCandidate);
      }
      if (scopeKey !== undefined && !scope) {
        scope = { sequence: 0, tail: Promise.resolve(), references: 0, expiresAt: Infinity };
        this.scopes.set(scopeKey, scope);
      }
      if (scope) {
        if (scopeKey !== undefined) this.idleScopes.delete(scopeKey);
        scope.references++;
        scope.expiresAt = Infinity;
      }
      let complete!: () => void;
      const done = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const entry: DedupEntry = { active: true, expiresAt: Infinity, done };
      const task = new EventTask(
        event,
        this.options,
        this.client,
        this.reporter,
        scope,
        (actor, source, question, options, location) =>
          this.ask(queued, actor, source, question, options, location),
        {
          managedSignals: this.managedSignals,
          cancelPrompt: (signal) =>
            this.prompts.cancelSignal(
              queued,
              signal,
              new FrameworkError(
                'INVALID_STATE',
                'Attachment handler ended without awaiting its prompt',
              ),
            ),
        },
        undefined,
        this.clock,
      );
      const queued: QueuedTask = {
        task,
        bytes,
        ...(key === undefined ? {} : { entry, key }),
        ...(scope && scopeKey !== undefined ? { scope, scopeKey } : {}),
        resolve: complete,
        started: false,
        running: false,
        runningSince: 0,
        processingMs: 0,
        children: new Set(),
        finished: false,
      };
      if (key !== undefined) this.dedup.set(key, entry);
      if (!observationOnly) this.events.accepted++;
      this.lastEventAt = event.receivedAt;
      this.retainedBytes += bytes;
      this.pool?.retain(bytes);
      this.managedSignals.add(task.controller.signal);
      this.tasks.add(queued);
      if (prompt && event.kind === 'message') {
        if (!this.prompts.claim(prompt, queued, event.content)) this.fallback(queued);
        return { status: 'accepted', done };
      }
      this.pool?.enqueued();
      this.waiting.push({ queued, enqueuedAt: now });
      if (autoAck) {
        this.controls++;
        task.ack().then(
          () => this.controlFinished(),
          () => this.controlFinished(),
        );
      }
      this.pump();
      return observationOnly ? { status: 'ignored' } : { status: 'accepted', done };
    } catch (error) {
      this.events.failed++;
      this.reporter.report(error, { phase: 'protocol', appId: this.options.appId });
      return { status: 'failed' };
    }
  }

  private controlFinished(): void {
    this.controls--;
    this.notify();
  }
  private prune(now: number): void {
    if (now < this.nextExpiry) return;
    let nextExpiry = Infinity;
    for (const [key, entry] of this.idleDedup) {
      if (entry.expiresAt > now) {
        nextExpiry = Math.min(nextExpiry, entry.expiresAt);
        break;
      }
      this.idleDedup.delete(key);
      this.dedup.delete(key);
    }
    for (const [key, scope] of this.idleScopes) {
      if (scope.expiresAt > now) {
        nextExpiry = Math.min(nextExpiry, scope.expiresAt);
        break;
      }
      this.idleScopes.delete(key);
      this.scopes.delete(key);
    }
    this.nextExpiry = nextExpiry;
  }
  private pump(): void {
    if (this.pool) {
      this.pool.pump();
      return;
    }
    this.pumpOne(false);
  }
  private pumpOne(single = true): boolean {
    let dispatched = false;
    let didRun = false;
    while (
      !dispatched &&
      !this.terminated &&
      this.active < this.options.execution.concurrency &&
      this.pending > 0
    ) {
      this.pool?.dequeued();
      const item = this.waiting[this.head];
      this.waiting[this.head++] = undefined;
      if (!item || item.queued.finished) continue;
      dispatched = single;
      didRun = true;
      const task = item.queued;
      this.active++;
      task.running = true;
      task.runningSince = this.clock.monotonic();
      this.observe('queueWait', task.runningSince - item.enqueuedAt);
      if (item.resume) {
        item.resume();
        continue;
      }
      task.started = true;
      Promise.resolve()
        .then(() => this.execute(task.task))
        .catch((error: unknown) => task.task.report(error, 'command'))
        .then(() => {
          this.prompts.cancelOwner(
            task,
            new FrameworkError(
              'INVALID_STATE',
              'Message handler ended without awaiting its prompt',
            ),
          );
          return task.task.ledger.sealAndDrain();
        })
        .then(
          () => this.finish(task),
          (error: unknown) => {
            task.task.report(error, 'shutdown');
            this.finish(task);
          },
        );
    }
    if (this.head > 512 || this.head === this.waiting.length) {
      this.waiting.splice(0, this.head);
      this.head = 0;
    }
    return didRun;
  }
  private finish(queued: QueuedTask): void {
    if (queued.finished) return;
    queued.finished = true;
    this.prompts.cancelOwner(
      queued,
      new FrameworkError('INVALID_STATE', 'Event context has finished'),
    );
    this.stopRunning(queued);
    if (queued.started) this.observe('processing', queued.processingMs);
    for (const child of queued.children) this.finish(child);
    queued.children.clear();
    if (queued.task.failed) this.events.failed++;
    this.retainedBytes -= queued.bytes;
    this.pool?.release(queued.bytes);
    if (queued.entry && queued.key !== undefined) {
      queued.entry.active = false;
      queued.entry.expiresAt = this.clock.monotonic() + this.options.execution.dedupTtlMs;
      this.idleDedup.set(queued.key, queued.entry);
      this.nextExpiry = Math.min(this.nextExpiry, queued.entry.expiresAt);
    }
    if (queued.scope) {
      queued.scope.references--;
      if (!queued.scope.references && queued.scopeKey !== undefined) {
        queued.scope.expiresAt = this.clock.monotonic() + this.options.execution.replyScopeTtlMs;
        this.idleScopes.set(queued.scopeKey, queued.scope);
        this.nextExpiry = Math.min(this.nextExpiry, queued.scope.expiresAt);
      }
    }
    queued.task.controller.abort(new FrameworkError('INVALID_STATE', 'Event context has finished'));
    this.managedSignals.delete(queued.task.controller.signal);
    this.tasks.delete(queued);
    queued.resolve();
    this.notify();
    this.pump();
  }
  private notify(): void {
    for (const callback of [...this.changed]) callback();
  }

  async idle(deadline = Infinity): Promise<void> {
    if (!this.tasks.size) return;
    const promise = new Promise<void>((resolve) => {
      const check = () => {
        if (!this.tasks.size) {
          this.changed.delete(check);
          resolve();
        }
      };
      this.changed.add(check);
      check();
    });
    if (deadline === Infinity) await promise;
    else await bounded(promise, deadline, undefined, this.clock);
  }

  async waitForCapacity(signal: AbortSignal): Promise<void> {
    while (true) {
      signal.throwIfAborted();
      if (!this.accepting) throw new FrameworkError('INVALID_STATE', 'Application is stopping');
      this.prune(this.clock.monotonic());
      const config = this.options.execution;
      if (
        (this.pool?.canResume() ?? true) &&
        this.pending <= config.queueCapacity / 2 &&
        this.retainedBytes <= config.queueMaxBytes / 2 &&
        this.controls < config.concurrency &&
        this.scopes.size < config.replyScopeMaxEntries
      )
        return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.changed.delete(wake);
          stopWatching?.();
          signal.removeEventListener('abort', abort);
          timer?.cancel();
        };
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(errorOf(signal.reason));
        };
        const nextExpiry = this.idleScopes.values().next().value?.expiresAt ?? Infinity;
        const timer = Number.isFinite(nextExpiry)
          ? this.clock.timeout(wake, Math.max(1, nextExpiry - this.clock.monotonic()))
          : undefined;
        const stopWatching = this.pool?.onChange(wake);
        this.changed.add(wake);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }

  abort(): void {
    this.terminated = true;
    this.accepting = false;
    this.prompts.close(
      new FrameworkError('SHUTDOWN_TIMEOUT', 'Application closed before the prompt completed'),
      true,
    );
    this.pool?.dequeued(this.pending);
    this.waiting.length = 0;
    this.head = 0;
    for (const queued of [...this.tasks]) {
      queued.task.failed = true;
      queued.task.controller.abort(
        new FrameworkError('SHUTDOWN_TIMEOUT', 'Application closed before the event completed'),
      );
      queued.task.ledger.sealAndDrain().catch(() => {});
      this.finish(queued);
    }
    this.unregister?.();
    this.unregister = undefined;
    this.dedup.clear();
    this.scopes.clear();
    this.idleDedup.clear();
    this.idleScopes.clear();
    this.nextExpiry = Infinity;
    this.notify();
  }
}
