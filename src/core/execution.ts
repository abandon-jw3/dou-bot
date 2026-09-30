import type {
  ButtonContext,
  ErrorContext,
  ErrorPhase,
  MessageContext,
  MessageInput,
  PromptOptions,
  PromptResult,
  QQClient,
  QQEventContext,
  SendResult,
} from '../contracts.js';
import type { ResolvedOptions } from './config.js';
import type { ErrorReporter } from './logging.js';
import type { NormalizedEvent } from '../qq/normalize.js';
import { normalize, isDispatch } from '../qq/normalize.js';
import { errorOf, FrameworkError } from './errors.js';
import { snapshotMessage, targetKey } from '../message/index.js';
import { bounded } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { PromptManager } from './prompts.js';

export type HandlerLocation = Pick<ErrorContext, 'controller' | 'method'>;

export type Admission =
  | { status: 'accepted' | 'duplicate'; done: Promise<void> }
  | { status: 'ignored' | 'overloaded' | 'stopping' | 'failed' };
interface DedupEntry {
  active: boolean;
  expiresAt: number;
  done: Promise<void>;
}
interface ReplyScope {
  sequence: number;
  tail: Promise<void>;
  references: number;
  expiresAt: number;
}
interface MessageBinding {
  event: Extract<NormalizedEvent, { kind: 'message' }>;
  scope: ReplyScope;
}
type Ask = (
  source: MessageBinding,
  question: MessageInput,
  options: PromptOptions,
  location?: HandlerLocation,
) => Promise<PromptResult>;

export class OperationLedger {
  private sealed = false;
  private count = 0;
  private readonly operations: Promise<unknown>[] = [];
  constructor(
    private readonly maximum: number,
    private readonly report: (
      error: unknown,
      phase: ErrorPhase,
      location?: HandlerLocation,
    ) => void,
  ) {}
  get open(): boolean {
    return !this.sealed;
  }
  run<T>(phase: ErrorPhase, operation: () => Promise<T>, location?: HandlerLocation): Promise<T> {
    let result: Promise<T>;
    let registered = false;
    try {
      if (this.sealed) throw new FrameworkError('INVALID_STATE', 'Event context has finished');
      if (this.count >= this.maximum)
        throw new FrameworkError('RESOURCE_LIMIT', 'Too many context operations');
      this.count++;
      registered = true;
      result = operation();
    } catch (error) {
      result = Promise.reject(errorOf(error));
    }
    result.catch((error: unknown) => this.report(error, phase, location));
    if (registered) this.operations.push(result);
    return result;
  }
  async sealAndDrain(): Promise<void> {
    this.sealed = true;
    await Promise.allSettled(this.operations);
    this.operations.length = 0;
  }
}

export class EventTask {
  readonly controller = new AbortController();
  readonly ledger: OperationLedger;
  failed = false;
  manualReplies = 0;
  private readonly reported = new Set<unknown>();
  private acknowledgment: { code: number; promise: Promise<void> } | undefined;
  constructor(
    readonly event: NormalizedEvent,
    private readonly options: ResolvedOptions,
    private readonly client: QQClient,
    private readonly reporter: ErrorReporter,
    private readonly scope?: ReplyScope,
    private readonly ask?: Ask,
  ) {
    this.ledger = new OperationLedger(
      options.execution.maxContextOperations,
      (error, phase, location) => this.report(error, phase, location),
    );
  }

  report(error: unknown, phase: ErrorPhase, location?: HandlerLocation): void {
    this.failed = true;
    if (this.reported.has(error)) return;
    if (this.reported.size < this.options.execution.maxContextOperations + 2)
      this.reported.add(error);
    this.reporter.report(error, {
      phase,
      appId: this.options.appId,
      eventName: this.event.raw.t,
      ...(this.event.raw.id ? { eventId: this.event.raw.id } : {}),
      ...(this.event.kind === 'message' ? { messageId: this.event.messageId } : {}),
      ...location,
    });
  }

  context(event: NormalizedEvent = this.event): QQEventContext {
    return Object.freeze({
      appId: this.options.appId,
      eventName: event.raw.t,
      ...(event.raw.id === undefined ? {} : { eventId: event.raw.id }),
      receivedAt: event.receivedAt,
      raw: event.raw,
      signal: this.controller.signal,
      client: this.client,
    });
  }

  messageContext(location?: HandlerLocation, source?: MessageBinding): MessageContext {
    const event = source?.event ?? this.event;
    if (event.kind !== 'message') throw new FrameworkError('INVALID_STATE', 'Not a message event');
    const shared = {
      ...this.context(event),
      messageId: event.messageId,
      userId: event.userId,
      content: event.content,
      attachments: event.attachments,
      ...(event.timestamp === undefined ? {} : { timestamp: event.timestamp }),
      reply: (message: MessageInput) => {
        this.manualReplies++;
        return this.send(message, true, location, source);
      },
      send: (message: MessageInput) => this.send(message, false, location, source),
      prompt: (question: MessageInput, options: PromptOptions = {}) =>
        this.ledger.run(
          'prompt',
          () => {
            const scope = source?.scope ?? this.scope;
            if (!this.ask || !scope)
              throw new FrameworkError('INVALID_STATE', 'Prompt context is unavailable');
            return this.ask({ event, scope }, question, options, location);
          },
          location,
        ),
    };
    return event.target.scene === 'group'
      ? Object.freeze({
          ...shared,
          scene: 'group',
          groupId: event.target.groupId,
          ...(event.memberRole === undefined ? {} : { memberRole: event.memberRole }),
          target: event.target,
        })
      : Object.freeze({ ...shared, scene: 'private', target: event.target });
  }

  buttonContext(location?: HandlerLocation): ButtonContext {
    const event = this.event;
    if (event.kind !== 'button') throw new FrameworkError('INVALID_STATE', 'Not an interaction');
    const shared = {
      ...this.context(),
      interactionId: event.interactionId,
      buttonId: event.buttonId,
      data: event.data,
      userId: event.userId,
      ack: (code?: number) => this.ack(code, location),
      send: (message: MessageInput) => this.send(message, false, location),
    };
    return event.target.scene === 'group'
      ? Object.freeze({ ...shared, scene: 'group', target: event.target })
      : Object.freeze({ ...shared, scene: 'private', target: event.target });
  }

  ack(code = 0, location?: HandlerLocation): Promise<void> {
    if (this.ledger.open && this.acknowledgment?.code === code) return this.acknowledgment.promise;
    const promise = this.ledger.run(
      'interaction-ack',
      () => {
        if (this.event.kind !== 'button' || !Number.isSafeInteger(code) || code < 0)
          throw new FrameworkError('HANDLER_CONTRACT', 'Invalid interaction acknowledgment');
        if (this.acknowledgment)
          throw new FrameworkError('HANDLER_CONTRACT', 'Acknowledgment code is already fixed');
        return this.client.api.acknowledgeInteraction(this.event.interactionId, code, {
          signal: this.controller.signal,
        });
      },
      location,
    );
    if (!this.acknowledgment) this.acknowledgment = { code, promise };
    return promise;
  }

  send(
    input: MessageInput,
    reply: boolean,
    location?: HandlerLocation,
    source?: MessageBinding,
  ): Promise<SendResult> {
    return this.ledger.run(
      'send',
      () => {
        const event = source?.event ?? this.event;
        const scope = source?.scope ?? this.scope;
        if (event.kind === 'event')
          throw new FrameworkError('INVALID_STATE', 'Event has no send target');
        const message = snapshotMessage(input, this.options.api.maxUploadBytes);
        const target = event.target;
        const signal = this.controller.signal;
        if (!reply) return this.client.sendMessage(target, message, { signal });
        if (event.kind !== 'message' || !scope)
          throw new FrameworkError('INVALID_STATE', 'Interaction IDs cannot be message references');
        const reference = { messageId: event.messageId, sequence: ++scope.sequence };
        const result = scope.tail.then(() => {
          signal.throwIfAborted();
          return this.client.sendMessage(target, message, { signal, reply: reference });
        });
        scope.tail = result.then(
          () => {},
          () => {},
        );
        return result;
      },
      location,
    );
  }
}

interface QueuedTask {
  task: EventTask;
  bytes: number;
  entry?: DedupEntry;
  scope?: ReplyScope;
  resolve(): void;
  started: boolean;
  running: boolean;
  children: Set<QueuedTask>;
  finished: boolean;
}
interface QueueItem {
  queued: QueuedTask;
  resume?: () => void;
}

export class Execution {
  readonly managedSignals = new Set<AbortSignal>();
  readonly events = { accepted: 0, duplicates: 0, rejected: 0, failed: 0 };
  private readonly dedup = new Map<string, DedupEntry>();
  private readonly scopes = new Map<string, ReplyScope>();
  private readonly waiting: (QueueItem | undefined)[] = [];
  private readonly prompts: PromptManager<QueuedTask, QueuedTask>;
  private head = 0;
  private readonly tasks = new Set<QueuedTask>();
  private readonly changed = new Set<() => void>();
  private accepting = false;
  private terminated = false;
  private active = 0;
  private controls = 0;
  private retainedBytes = 0;
  lastEventAt: number | undefined;

  constructor(
    private readonly options: ResolvedOptions,
    private readonly client: QQClient,
    private readonly reporter: ErrorReporter,
    private readonly execute: (task: EventTask) => Promise<void>,
    private readonly handles: (event: NormalizedEvent) => boolean = () => true,
    private readonly clock: Clock = systemClock,
  ) {
    this.prompts = new PromptManager(options.prompts, clock, {
      suspend: (owner) => {
        if (owner.finished || !owner.running)
          throw new FrameworkError('INVALID_STATE', 'Prompt owner is not executing');
        owner.running = false;
        this.active--;
        this.notify();
        this.pump();
      },
      resume: (owner, continuation) => {
        if (owner.finished || this.terminated) {
          continuation();
          return;
        }
        this.waiting.push({ queued: owner, resume: continuation });
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

  private promptKey(event: Extract<NormalizedEvent, { kind: 'message' }>): string {
    return JSON.stringify([this.options.appId, targetKey(event.target), event.userId]);
  }
  private ask(
    owner: QueuedTask,
    source: MessageBinding,
    question: MessageInput,
    options: PromptOptions,
    location?: HandlerLocation,
  ): Promise<PromptResult> {
    if (!this.accepting || owner.finished || !owner.running)
      throw new FrameworkError('INVALID_STATE', 'Prompt requires a running message handler');
    return this.prompts.request(
      owner,
      this.promptKey(source.event),
      owner.task.controller.signal,
      () => {
        owner.task.manualReplies++;
        return owner.task.send(question, true, location, source);
      },
      (input) => {
        if (owner.finished || input.finished || input.task.event.kind !== 'message' || !input.scope)
          throw new FrameworkError('INVALID_STATE', 'Prompt message context has finished');
        owner.children.add(input);
        return owner.task.messageContext(location, { event: input.task.event, scope: input.scope });
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
    this.waiting.push({ queued: input });
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
      this.events.rejected++;
      return { status: 'ignored' };
    }
    try {
      const parsed = normalize(payload, this.clock.wallTime());
      if (parsed.status === 'invalid') {
        this.events.rejected++;
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
      if (
        this.dedup.size >= config.dedupMaxEntries ||
        this.scopes.size >= config.replyScopeMaxEntries
      )
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
      let existing = key === undefined ? undefined : this.dedup.get(key);
      if (existing && !existing.active && existing.expiresAt <= now && key !== undefined) {
        this.dedup.delete(key);
        existing = undefined;
      }
      if (existing) {
        this.events.duplicates++;
        return { status: 'duplicate', done: existing.done };
      }
      const prompt =
        event.kind === 'message' ? this.prompts.find(this.promptKey(event)) : undefined;
      if (
        !prompt &&
        !this.handles(event) &&
        !(event.kind === 'button' && this.options.acknowledge === 'auto')
      )
        return { status: 'ignored' };
      const scopeKey =
        event.kind === 'message'
          ? JSON.stringify([this.options.appId, targetKey(event.target), event.messageId])
          : undefined;
      let scope = scopeKey === undefined ? undefined : this.scopes.get(scopeKey);
      if (scope && !scope.references && scope.expiresAt <= now && scopeKey !== undefined) {
        this.scopes.delete(scopeKey);
        scope = undefined;
      }
      const autoAck = event.kind === 'button' && this.options.acknowledge === 'auto';
      if (
        (!prompt && this.pending + this.active >= config.queueCapacity + config.concurrency) ||
        this.retainedBytes + bytes > config.queueMaxBytes ||
        (autoAck && this.controls >= config.concurrency) ||
        (scopeKey !== undefined && !scope && this.scopes.size >= config.replyScopeMaxEntries)
      ) {
        this.events.rejected++;
        return { status: 'overloaded' };
      }
      if (key !== undefined && this.dedup.size >= config.dedupMaxEntries) {
        const expiredCandidate = [...this.dedup.entries()].find(([, entry]) => !entry.active);
        if (!expiredCandidate) {
          this.events.rejected++;
          return { status: 'overloaded' };
        }
        this.dedup.delete(expiredCandidate[0]);
      }
      if (scopeKey !== undefined && !scope) {
        scope = { sequence: 0, tail: Promise.resolve(), references: 0, expiresAt: Infinity };
        this.scopes.set(scopeKey, scope);
      }
      if (scope) {
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
        (source, question, options, location) =>
          this.ask(queued, source, question, options, location),
      );
      const queued: QueuedTask = {
        task,
        bytes,
        ...(key === undefined ? {} : { entry }),
        ...(scope ? { scope } : {}),
        resolve: complete,
        started: false,
        running: false,
        children: new Set(),
        finished: false,
      };
      if (key !== undefined) this.dedup.set(key, entry);
      this.events.accepted++;
      this.lastEventAt = event.receivedAt;
      this.retainedBytes += bytes;
      this.managedSignals.add(task.controller.signal);
      this.tasks.add(queued);
      if (prompt && event.kind === 'message') {
        if (!this.prompts.claim(prompt, queued, event.content)) this.fallback(queued);
        return { status: 'accepted', done };
      }
      this.waiting.push({ queued });
      if (autoAck) {
        this.controls++;
        task.ack().then(
          () => this.controlFinished(),
          () => this.controlFinished(),
        );
      }
      this.pump();
      return { status: 'accepted', done };
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
    for (const [key, entry] of this.dedup)
      if (!entry.active && entry.expiresAt <= now) this.dedup.delete(key);
    for (const [key, scope] of this.scopes)
      if (!scope.references && scope.expiresAt <= now) this.scopes.delete(key);
  }
  private pump(): void {
    while (
      !this.terminated &&
      this.active < this.options.execution.concurrency &&
      this.pending > 0
    ) {
      const item = this.waiting[this.head];
      this.waiting[this.head++] = undefined;
      if (!item || item.queued.finished) continue;
      const task = item.queued;
      this.active++;
      task.running = true;
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
  }
  private finish(queued: QueuedTask): void {
    if (queued.finished) return;
    queued.finished = true;
    this.prompts.cancelOwner(
      queued,
      new FrameworkError('INVALID_STATE', 'Event context has finished'),
    );
    if (queued.running) {
      queued.running = false;
      this.active--;
    }
    for (const child of queued.children) this.finish(child);
    queued.children.clear();
    if (queued.task.failed) this.events.failed++;
    this.retainedBytes -= queued.bytes;
    if (queued.entry) {
      queued.entry.active = false;
      queued.entry.expiresAt = this.clock.monotonic() + this.options.execution.dedupTtlMs;
    }
    if (queued.scope) {
      queued.scope.references--;
      if (!queued.scope.references)
        queued.scope.expiresAt = this.clock.monotonic() + this.options.execution.replyScopeTtlMs;
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
        this.pending <= config.queueCapacity / 2 &&
        this.retainedBytes <= config.queueMaxBytes / 2 &&
        this.controls < config.concurrency &&
        this.scopes.size < config.replyScopeMaxEntries
      )
        return;
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this.changed.delete(wake);
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
        let nextExpiry = Infinity;
        for (const scope of this.scopes.values())
          if (!scope.references && scope.expiresAt < nextExpiry) nextExpiry = scope.expiresAt;
        const timer = Number.isFinite(nextExpiry)
          ? this.clock.timeout(wake, Math.max(1, nextExpiry - this.clock.monotonic()))
          : undefined;
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
    this.dedup.clear();
    this.scopes.clear();
    this.notify();
  }
}
