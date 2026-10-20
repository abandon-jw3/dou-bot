import type { DefaultQQClient } from './client.js';
import { apiFacade, clientFacade, invokeApi, invokeClient } from './facade.js';
import type { ApiMethod, ClientMethod } from './facade.js';
import { QQClient } from '../contracts.js';
import type {
  QQApi,
  ApiRequestOptions,
  BotUser,
  MessageInput,
  OutgoingMessage,
  MessageTarget,
  RequestOptions,
  SendOptions,
  SendResult,
  UploadedImage,
} from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import { OutboundQueue } from '../core/outbound.js';
import type { Clock } from '../core/clock.js';
import { errorOf, FrameworkError } from '../core/errors.js';
import { copyTarget, snapshotMessage } from '../message/index.js';
import { isRecord } from '../core/utils.js';
import type { Diagnostics } from '../diagnostics/observer.js';

function optionsSnapshot(input: unknown): RequestOptions {
  if (input === undefined) return {};
  if (!isRecord(input))
    throw new FrameworkError('HANDLER_CONTRACT', 'Request options must be an object');
  return { ...input };
}
export function messageBytes(message: MessageInput): number {
  if (
    typeof message !== 'string' &&
    message.kind === 'image' &&
    message.source instanceof Uint8Array
  )
    return message.source.byteLength + Buffer.byteLength(message.caption ?? '') + 128;
  return Buffer.byteLength(JSON.stringify(message)) + 128;
}
/** Explicit account client. The raw client and API never escape this wrapper. */
export class ManagedQQClient extends QQClient {
  override readonly api: QQApi;
  private readonly controls: OutboundQueue;
  constructor(
    private readonly raw: DefaultQQClient,
    private readonly config: ResolvedOptions,
    private readonly queue: OutboundQueue,
    private readonly allowed: (signal?: AbortSignal) => void,
    private readonly managed: Set<AbortSignal>,
    private readonly isContextSignal: (signal: AbortSignal) => boolean,
    private readonly report: (error: unknown) => void,
    clock: Clock,
    observer?: Diagnostics,
  ) {
    super();
    // Protocol acknowledgments must not wait behind user messages, but still need
    // their own bounded operation lifetime, including token refresh and shutdown.
    this.controls = new OutboundQueue(
      {
        concurrency: config.execution.concurrency,
        queueCapacity: 0,
        queueMaxBytes: config.execution.queueMaxBytes,
      },
      clock,
      observer,
      'control',
    );
    this.api = apiFacade(
      <T>(method: ApiMethod, args: readonly unknown[], input?: ApiRequestOptions): Promise<T> =>
        this.observe(() => {
          const options = optionsSnapshot(input);
          const values = structuredClone(args);
          const { signal: _signal, ...rest } = input ?? {};
          void _signal;
          const copied = structuredClone(rest);
          const bytes = Buffer.byteLength(JSON.stringify([values, copied])) + 128;
          const run = (signal: AbortSignal) =>
            invokeApi<T>(raw.api, method, values, { ...copied, signal });
          return method === 'acknowledgeInteraction'
            ? this.schedule(this.controls, bytes, run, options)
            : this.run(bytes, run, options);
        }, input?.signal),
    );
  }
  private observe<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const contextual = signal instanceof AbortSignal && this.isContextSignal(signal);
    let result: Promise<T>;
    try {
      result = operation();
    } catch (error) {
      result = Promise.reject(errorOf(error));
    }
    result.catch((error: unknown) => {
      if (!contextual) this.report(error);
    });
    return result;
  }
  private target(input: MessageTarget): MessageTarget {
    if (
      isRecord(input) &&
      'appId' in input &&
      input.appId !== undefined &&
      input.appId !== this.config.appId
    )
      throw new FrameworkError('HANDLER_CONTRACT', 'Target belongs to a different bot');
    return copyTarget(input);
  }
  idleControls(deadline: number): Promise<void> {
    return this.controls.idle(deadline);
  }
  closeControls(): void {
    this.controls.close();
  }
  private run<T>(
    bytes: number,
    run: (signal: AbortSignal) => Promise<T>,
    options: RequestOptions,
  ): Promise<T> {
    return this.schedule(this.queue, bytes, run, options);
  }
  private schedule<T>(
    queue: OutboundQueue,
    bytes: number,
    run: (signal: AbortSignal) => Promise<T>,
    options: RequestOptions,
  ): Promise<T> {
    this.allowed(options.signal);
    return queue.run(
      this.config.appId,
      bytes,
      async (signal) => {
        this.managed.add(signal);
        try {
          return await run(signal);
        } finally {
          this.managed.delete(signal);
        }
      },
      options.signal,
    );
  }
  override getSelf(options?: RequestOptions): Promise<BotUser> {
    return this.api.getSelf(options);
  }
  override sendMessage(
    targetInput: MessageTarget,
    input: MessageInput,
    options: SendOptions = {},
  ): Promise<SendResult> {
    return this.observe(() => {
      const target = this.target(targetInput);
      const message = snapshotMessage(input, this.config.api.maxUploadBytes);
      if (!isRecord(options))
        throw new FrameworkError('HANDLER_CONTRACT', 'Send options must be an object');
      const copied: SendOptions = {
        ...options,
        ...(options.reply
          ? { reply: { ...(options.reply as NonNullable<SendOptions['reply']>) } }
          : {}),
      };
      return this.run(
        messageBytes(message),
        (signal) => this.raw.sendPreparedMessage(target, message, { ...copied, signal }),
        copied,
      );
    }, options?.signal);
  }
  /** The event ledger already owns this snapshot and its errors. */
  sendPreparedMessage(
    target: MessageTarget,
    message: OutgoingMessage,
    options: SendOptions,
  ): Promise<SendResult> {
    return this.run(
      messageBytes(message),
      (signal) => this.raw.sendPreparedMessage(target, message, { ...options, signal }),
      options,
    );
  }
  async sendAdmitted(
    targetInput: MessageTarget,
    message: OutgoingMessage,
    options: SendOptions,
  ): Promise<SendResult> {
    const target = this.target(targetInput);
    const signal = options.signal!;
    this.managed.add(signal);
    try {
      this.allowed(options.signal);
      return await this.raw.sendPreparedMessage(target, message, options);
    } finally {
      this.managed.delete(signal);
    }
  }
  override uploadImage(
    targetInput: MessageTarget,
    sourceInput: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage> {
    return this.observe(() => {
      const target = this.target(targetInput);
      const checked = snapshotMessage(
        { kind: 'image', source: sourceInput },
        this.config.api.maxUploadBytes,
      );
      if (
        checked.kind !== 'image' ||
        !(typeof checked.source === 'string' || checked.source instanceof Uint8Array)
      )
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid upload');
      const source = checked.source;
      const copied = optionsSnapshot(options);
      return this.run(
        typeof source === 'string' ? Buffer.byteLength(source) + 128 : source.byteLength + 128,
        (signal) => this.raw.uploadPreparedImage(target, source, { ...copied, signal }),
        copied,
      );
    }, options?.signal);
  }
  override deleteMessage(
    targetInput: MessageTarget,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> {
    return this.observe(() => {
      const target = this.target(targetInput);
      const copied = optionsSnapshot(options);
      return this.run(
        Buffer.byteLength(JSON.stringify([target, messageId])) + 128,
        (signal) => this.raw.deleteMessage(target, messageId, { ...copied, signal }),
        copied,
      );
    }, options?.signal);
  }
}

/** Context-scoped facade: every public operation is counted, cancelled and drained with its event. */
export function scopedClient(
  client: QQClient,
  signal: AbortSignal,
  track: <T>(operation: () => Promise<T>) => Promise<T>,
  signals?: Set<AbortSignal>,
  observer?: Diagnostics,
): QQClient {
  const run = <T>(
    operation: (options: SendOptions) => Promise<T>,
    input?: SendOptions,
  ): Promise<T> =>
    track(() => {
      signal.throwIfAborted();
      const options = optionsSnapshot(input);
      const combined = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
      const registered = combined !== signal;
      if (registered) {
        signals?.add(combined);
        observer?.inherit(signal, combined);
      }
      try {
        return operation({ ...options, signal: combined }).finally(() => {
          if (registered) {
            signals?.delete(combined);
            observer?.unbind(combined);
          }
        });
      } catch (error) {
        if (registered) {
          signals?.delete(combined);
          observer?.unbind(combined);
        }
        throw error;
      }
    });
  return clientFacade(
    <T>(method: ClientMethod, args: readonly unknown[], options?: SendOptions) =>
      run((current) => invokeClient<T>(client, method, args, current), options),
    () =>
      apiFacade(<T>(method: ApiMethod, args: readonly unknown[], options?: ApiRequestOptions) =>
        run((current) => invokeApi<T>(client.api, method, args, current), options),
      ),
  );
}
