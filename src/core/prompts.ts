import type { PromptConfig, PromptMessage, PromptOptions, PromptResult } from '../contracts.js';
import { FrameworkError, errorOf } from './errors.js';
import type { FrameworkErrorCode } from '../contracts.js';
import type { Clock, Timer } from './clock.js';
import { isRecord } from './utils.js';

export type PromptSettings = Readonly<Required<PromptConfig>>;
type Outcome =
  { status: 'received' | 'cancelled' | 'timeout' } | { status: 'failed'; error: Error };

function keys(
  value: unknown,
  allowed: readonly string[],
  code: FrameworkErrorCode,
): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    throw new FrameworkError(code, 'Invalid prompt options');
}
function duration(
  value: unknown,
  fallback: number,
  maximum: number,
  code: FrameworkErrorCode,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > maximum)
    throw new FrameworkError(code, 'Invalid prompt duration or capacity');
  return value;
}
function words(
  value: unknown,
  fallback: readonly string[],
  code: FrameworkErrorCode,
): readonly string[] {
  if (value === undefined) return fallback;
  if (
    !Array.isArray(value) ||
    !Array.from(value as unknown[]).every((word) => typeof word === 'string' && !!word.trim())
  )
    throw new FrameworkError(code, 'Prompt cancelWords must be nonempty strings');
  return Object.freeze([...new Set((value as string[]).map((word) => word.trim()))]);
}
export function resolvePrompts(raw: PromptConfig = {}): PromptSettings {
  keys(raw, ['timeoutMs', 'cancelWords', 'maxPending', 'maxTimeoutMs'], 'CONFIG');
  const maxTimeoutMs = duration(raw.maxTimeoutMs, 300000, 2147483647, 'CONFIG');
  const timeoutMs = duration(raw.timeoutMs, Math.min(60000, maxTimeoutMs), maxTimeoutMs, 'CONFIG');
  return Object.freeze({
    timeoutMs,
    maxTimeoutMs,
    maxPending: duration(raw.maxPending, 1000, 2147483647, 'CONFIG'),
    cancelWords: words(raw.cancelWords, Object.freeze(['取消']), 'CONFIG'),
  });
}

export interface PromptTicket<Owner, Input> {
  readonly key: string;
  readonly owner: Owner;
  readonly signal: AbortSignal;
  readonly receive: (input: Input) => PromptMessage;
  readonly timeoutMs: number;
  readonly cancelWords: readonly string[];
  readonly resolve: (result: PromptResult) => void;
  readonly reject: (error: Error) => void;
  readonly abort: () => void;
  input: Input | undefined;
  outcome: Outcome | undefined;
  timer: Timer | undefined;
  deadline: number;
  sent: boolean;
  suspended: boolean;
  scheduled: boolean;
  done: boolean;
}

interface Hooks<Owner, Input> {
  suspend(owner: Owner): void;
  resume(owner: Owner, continuation: () => void): void;
  abort(owner: Owner, reason: Error): void;
  fallback(input: Input): void;
}

/** Per-application waiters. No network or routing: ownership stays with Execution. */
export class PromptManager<Owner, Input> {
  private readonly entries = new Map<string, PromptTicket<Owner, Input>>();
  private readonly owners = new Map<Owner, PromptTicket<Owner, Input>>();
  private closed = false;
  constructor(
    private readonly settings: PromptSettings,
    private readonly clock: Clock,
    private readonly hooks: Hooks<Owner, Input>,
  ) {}
  get size(): number {
    return this.entries.size;
  }

  request(
    owner: Owner,
    key: string,
    signal: AbortSignal,
    send: () => Promise<unknown>,
    receive: (input: Input) => PromptMessage,
    options: PromptOptions = {},
  ): Promise<PromptResult> {
    if (this.closed || signal.aborted)
      throw new FrameworkError('INVALID_STATE', 'Prompt context is stopping');
    keys(options, ['timeoutMs', 'cancelWords'], 'HANDLER_CONTRACT');
    const timeoutMs = duration(
      options.timeoutMs,
      this.settings.timeoutMs,
      this.settings.maxTimeoutMs,
      'HANDLER_CONTRACT',
    );
    const cancelWords = words(options.cancelWords, this.settings.cancelWords, 'HANDLER_CONTRACT');
    if (this.entries.has(key) || this.owners.has(owner))
      throw new FrameworkError(
        'INVALID_STATE',
        'A prompt is already pending for this conversation and user',
      );
    if (this.size >= this.settings.maxPending)
      throw new FrameworkError('RESOURCE_LIMIT', 'Too many pending prompts');
    let resolve!: (result: PromptResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<PromptResult>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    const ticket: PromptTicket<Owner, Input> = {
      key,
      owner,
      signal,
      receive,
      timeoutMs,
      cancelWords,
      resolve,
      reject,
      abort: () => this.cancel(ticket, errorOf(signal.reason), false),
      input: undefined,
      outcome: undefined,
      timer: undefined,
      deadline: Infinity,
      sent: false,
      suspended: false,
      scheduled: false,
      done: false,
    };
    // Reserve synchronously, before starting the question request, so fast input cannot slip past.
    this.entries.set(key, ticket);
    this.owners.set(owner, ticket);
    signal.addEventListener('abort', ticket.abort, { once: true });
    try {
      send()
        .then(
          () => {
            if (ticket.done) return;
            ticket.sent = true;
            if (ticket.outcome) {
              this.complete(ticket);
              return;
            }
            ticket.deadline = this.clock.monotonic() + timeoutMs;
            ticket.timer = this.clock.timeout(() => this.timeout(ticket), timeoutMs);
            ticket.timer.unref();
            ticket.suspended = true;
            this.hooks.suspend(owner);
          },
          (error: unknown) => this.cancel(ticket, errorOf(error), false),
        )
        .catch((error: unknown) => this.cancel(ticket, errorOf(error), false));
    } catch (error) {
      this.cancel(ticket, errorOf(error), false);
    }
    return promise;
  }

  find(key: string): PromptTicket<Owner, Input> | undefined {
    const ticket = this.entries.get(key);
    if (!ticket || ticket.done || ticket.outcome) return undefined;
    if (this.clock.monotonic() >= ticket.deadline) {
      this.timeout(ticket);
      return undefined;
    }
    return ticket;
  }
  claim(ticket: PromptTicket<Owner, Input>, input: Input, content: string): boolean {
    if (this.find(ticket.key) !== ticket) return false;
    ticket.input = input;
    ticket.outcome = {
      status: ticket.cancelWords.includes(content.trim()) ? 'cancelled' : 'received',
    };
    ticket.timer?.cancel();
    ticket.timer = undefined;
    if (ticket.sent) this.complete(ticket);
    return true;
  }
  private timeout(ticket: PromptTicket<Owner, Input>): void {
    if (ticket.done || ticket.outcome) return;
    ticket.outcome = { status: 'timeout' };
    this.complete(ticket);
  }
  private complete(ticket: PromptTicket<Owner, Input>): void {
    if (ticket.done) return;
    ticket.timer?.cancel();
    ticket.timer = undefined;
    if (!ticket.suspended) {
      this.publish(ticket);
      return;
    }
    if (ticket.scheduled) return;
    ticket.scheduled = true;
    this.hooks.resume(ticket.owner, () => this.publish(ticket));
  }
  private publish(ticket: PromptTicket<Owner, Input>): void {
    if (ticket.done || !ticket.outcome) return;
    ticket.done = true;
    ticket.timer?.cancel();
    ticket.timer = undefined;
    ticket.signal.removeEventListener('abort', ticket.abort);
    this.entries.delete(ticket.key);
    this.owners.delete(ticket.owner);
    const input = ticket.input;
    ticket.input = undefined;
    if (ticket.outcome.status === 'failed') {
      if (input !== undefined) this.hooks.fallback(input);
      ticket.reject(ticket.outcome.error);
      return;
    }
    try {
      // Cancel input is also owned by the workflow, keeping deduplication and reply scopes alive.
      const message = input === undefined ? undefined : ticket.receive(input);
      if (ticket.outcome.status === 'received') {
        if (!message) throw new FrameworkError('INVALID_STATE', 'Prompt input is missing');
        ticket.resolve({ status: 'received', message });
      } else ticket.resolve({ status: ticket.outcome.status });
    } catch (error) {
      if (input !== undefined) this.hooks.fallback(input);
      ticket.reject(errorOf(error));
    }
  }
  private cancel(ticket: PromptTicket<Owner, Input>, reason: Error, force: boolean): void {
    if (ticket.done) return;
    ticket.outcome = { status: 'failed', error: reason };
    if (force) this.publish(ticket);
    else this.complete(ticket);
  }
  cancelOwner(owner: Owner, reason: Error): void {
    const ticket = this.owners.get(owner);
    if (ticket) this.cancel(ticket, reason, true);
  }
  close(reason: Error, force = false): void {
    this.closed = true;
    for (const ticket of [...this.entries.values()]) {
      this.hooks.abort(ticket.owner, reason);
      this.cancel(ticket, reason, force);
    }
  }
}
