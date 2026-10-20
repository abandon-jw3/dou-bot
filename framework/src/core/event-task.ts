import type { ManagedQQClient } from '../qq/managed-client.js';
import { scopedClient } from '../qq/managed-client.js';
import type {
  ButtonContext,
  ContextKey,
  ContextReader,
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
import { errorOf, FrameworkError } from './errors.js';
import { snapshotMessage } from '../message/index.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { ContextState } from './context-state.js';
import type { Diagnostics, ObservationContext } from '../diagnostics/observer.js';

export type HandlerLocation = Pick<ErrorContext, 'controller' | 'method'>;

export interface ReplyScope {
  sequence: number;
  tail: Promise<void>;
  references: number;
  expiresAt: number;
}
export interface MessageBinding {
  event: Extract<NormalizedEvent, { kind: 'message' }>;
  scope: ReplyScope;
}
type Ask = (
  actor: EventTask,
  source: MessageBinding,
  question: MessageInput,
  options: PromptOptions,
  location?: HandlerLocation,
) => Promise<PromptResult>;

export class OperationLedger {
  private sealed = false;
  private readonly operations: Promise<unknown>[] = [];
  constructor(
    private readonly maximum: number,
    private readonly report: (
      error: unknown,
      phase: ErrorPhase,
      location?: HandlerLocation,
    ) => void,
    readonly budget = { count: 0 },
  ) {}
  get open(): boolean {
    return !this.sealed;
  }
  run<T>(phase: ErrorPhase, operation: () => Promise<T>, location?: HandlerLocation): Promise<T> {
    let result: Promise<T>;
    let registered = false;
    try {
      if (this.sealed) throw new FrameworkError('INVALID_STATE', 'Event context has finished');
      if (this.budget.count >= this.maximum)
        throw new FrameworkError('RESOURCE_LIMIT', 'Too many context operations');
      this.budget.count++;
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

interface TaskLifecycle {
  managedSignals: Set<AbortSignal>;
  cancelPrompt(signal: AbortSignal): void;
}

export class EventTask {
  diagnosticContext: ObservationContext | undefined;
  readonly controller = new AbortController();
  readonly ledger: OperationLedger;
  failed = false;
  manualReplies = 0;
  private readonly reported = new Set<unknown>();
  private acknowledgment: { code: number; promise: Promise<void> } | undefined;
  private data?: ContextState;
  private dataSealed = false;
  private dataReader?: ContextReader;
  private scoped?: QQClient;
  constructor(
    readonly event: NormalizedEvent,
    private readonly options: ResolvedOptions,
    private readonly client: ManagedQQClient,
    private readonly reporter: ErrorReporter,
    private readonly scope?: ReplyScope,
    private readonly ask?: Ask,
    private readonly lifecycle?: TaskLifecycle,
    private readonly parent?: EventTask,
    private readonly clock: Clock = systemClock,
    readonly observer?: Diagnostics,
    context?: ObservationContext,
  ) {
    this.diagnosticContext = context;
    observer?.bind(this.controller.signal, context);
    this.ledger = new OperationLedger(
      options.execution.maxContextOperations,
      (error, phase, location) => this.report(error, phase, location),
      parent?.ledger.budget,
    );
  }

  /** One attachment handler owns its context operations; budgets and reply sequences stay shared. */
  invocation(): EventTask {
    const child = new EventTask(
      this.event,
      this.options,
      this.client,
      this.reporter,
      this.scope,
      this.ask,
      this.lifecycle,
      this,
      this.clock,
      this.observer,
      this.diagnosticContext,
    );
    this.lifecycle?.managedSignals.add(child.controller.signal);
    const abort = () => {
      child.controller.abort(this.controller.signal.reason);
      this.lifecycle?.managedSignals.delete(child.controller.signal);
      this.observer?.unbind(child.controller.signal);
      child.ledger.sealAndDrain().catch(() => {});
    };
    this.controller.signal.addEventListener('abort', abort, { once: true });
    child.detach = () => this.controller.signal.removeEventListener('abort', abort);
    if (this.controller.signal.aborted) abort();
    return child;
  }
  private detach?: () => void;
  contextData(location?: HandlerLocation): ContextState {
    if (!this.data) {
      this.data = new ContextState(this.options.context, {
        signal: this.controller.signal,
        clock: this.clock,
        ...(this.lifecycle ? { managedSignals: this.lifecycle.managedSignals } : {}),
        track: (operation) => this.ledger.run('context', operation, location),
        report: (error) => this.report(error, 'context', location),
        ...(this.observer ? { observer: this.observer, context: this.diagnosticContext } : {}),
      });
      if (this.dataSealed) this.data.seal();
    }
    return this.data;
  }
  sealContextData(): void {
    this.dataSealed = true;
    this.data?.seal();
  }
  /** A stable lightweight facade; storage is allocated only when data is actually consumed. */
  contextReader(location?: HandlerLocation): ContextReader {
    return (this.dataReader ??= Object.freeze({
      get: <T>(key: ContextKey<T>) => this.contextData(location).reader.get(key),
    }));
  }
  async endInvocation(): Promise<void> {
    try {
      this.lifecycle?.cancelPrompt(this.controller.signal);
      await this.ledger.sealAndDrain();
    } finally {
      this.controller.abort(new FrameworkError('INVALID_STATE', 'Attachment handler has finished'));
      this.lifecycle?.managedSignals.delete(this.controller.signal);
      this.observer?.unbind(this.controller.signal);
      this.detach?.();
    }
  }

  report(error: unknown, phase: ErrorPhase, location?: HandlerLocation): void {
    this.failed = true;
    if (this.parent) this.parent.failed = true;
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

  get appId(): string {
    return this.options.appId;
  }
  contextBase(event: NormalizedEvent = this.event): Omit<QQEventContext, 'client'> {
    return {
      appId: this.options.appId,
      eventName: event.raw.t,
      ...(event.raw.id === undefined ? {} : { eventId: event.raw.id }),
      receivedAt: event.receivedAt,
      raw: event.raw,
      signal: this.controller.signal,
    };
  }
  private withClient<T extends object>(value: T): Readonly<T & { readonly client: QQClient }> {
    Object.defineProperty(value, 'client', {
      enumerable: true,
      get: () =>
        (this.scoped ??= scopedClient(
          this.client,
          this.controller.signal,
          (operation) => this.ledger.run('send', operation),
          this.lifecycle?.managedSignals,
          this.observer,
        )),
    });
    return Object.freeze(value) as Readonly<T & { readonly client: QQClient }>;
  }
  context(event: NormalizedEvent = this.event): QQEventContext {
    return this.withClient(this.contextBase(event));
  }

  messageContext(location?: HandlerLocation, source?: MessageBinding): MessageContext {
    const event = source?.event ?? this.event;
    if (event.kind !== 'message') throw new FrameworkError('INVALID_STATE', 'Not a message event');
    const shared = {
      ...this.contextBase(event),
      state: this.contextReader(location),
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
            return this.ask(this, { event, scope }, question, options, location);
          },
          location,
        ),
    };
    return event.target.scene === 'group'
      ? this.withClient({
          ...shared,
          scene: 'group' as const,
          groupId: event.target.groupId,
          ...(event.memberRole === undefined ? {} : { memberRole: event.memberRole }),
          target: Object.freeze({ ...event.target, appId: this.options.appId }),
        })
      : this.withClient({
          ...shared,
          scene: 'private' as const,
          target: Object.freeze({ ...event.target, appId: this.options.appId }),
        });
  }

  buttonContext(location?: HandlerLocation): ButtonContext {
    const event = this.event;
    if (event.kind !== 'button') throw new FrameworkError('INVALID_STATE', 'Not an interaction');
    const shared = {
      ...this.contextBase(),
      state: this.contextReader(location),
      interactionId: event.interactionId,
      buttonId: event.buttonId,
      data: event.data,
      userId: event.userId,
      ack: (code?: number) => this.ack(code, location),
      send: (message: MessageInput) => this.send(message, false, location),
    };
    return event.target.scene === 'group'
      ? this.withClient({
          ...shared,
          scene: 'group' as const,
          target: Object.freeze({ ...event.target, appId: this.options.appId }),
        })
      : this.withClient({
          ...shared,
          scene: 'private' as const,
          target: Object.freeze({ ...event.target, appId: this.options.appId }),
        });
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
        const preparation = this.observer?.start('message.prepare', this.diagnosticContext);
        let message: ReturnType<typeof snapshotMessage>;
        try {
          message = snapshotMessage(input, this.options.api.maxUploadBytes);
        } catch (error) {
          preparation?.fail(error);
          throw error;
        } finally {
          preparation?.end();
        }
        const target = event.target;
        const signal = this.controller.signal;
        if (!reply) return this.client.sendPreparedMessage(target, message, { signal });
        if (event.kind !== 'message' || !scope)
          throw new FrameworkError('INVALID_STATE', 'Interaction IDs cannot be message references');
        const reference = { messageId: event.messageId, sequence: ++scope.sequence };
        const waiting = this.observer?.start('reply.wait', this.diagnosticContext, signal);
        const result = scope.tail.then(() => {
          waiting?.end();
          signal.throwIfAborted();
          return this.client.sendPreparedMessage(target, message, { signal, reply: reference });
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
