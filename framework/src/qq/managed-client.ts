import type { DefaultQQClient } from './client.js';
import { QQClient } from '../contracts.js';
import type {
  ApiRequestOptions,
  ApiResponse,
  BotUser,
  HttpMethod,
  MessageInput,
  MessageTarget,
  QQApi,
  QQFileResult,
  QQMessagePayload,
  QQUploadImagePayload,
  RequestOptions,
  SendOptions,
  SendResult,
  UploadedImage,
} from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import { OutboundQueue } from '../core/outbound.js';
import type { Clock } from '../core/clock.js';
import { errorOf, FrameworkError } from '../core/errors.js';
import { copyTarget, prepareMessage } from '../message/index.js';
import type { PreparedMessage } from '../message/index.js';
import { isRecord } from '../core/utils.js';
import type { Diagnostics } from '../diagnostics/observer.js';

function optionsSnapshot<T extends RequestOptions>(input: unknown): T {
  if (input === undefined) return {} as T;
  if (!isRecord(input))
    throw new FrameworkError('HANDLER_CONTRACT', 'Request options must be an object');
  return { ...input } as unknown as T;
}

function uploadSnapshot(payload: QQUploadImagePayload): {
  snapshot: QQUploadImagePayload;
  bytes: number;
} {
  if (!isRecord(payload)) return { snapshot: payload, bytes: 128 };
  const snapshot = { ...payload };
  const payloadBytes =
    typeof snapshot.file_data === 'string'
      ? snapshot.file_data.length
      : typeof snapshot.url === 'string'
        ? Buffer.byteLength(snapshot.url)
        : 0;
  return { snapshot, bytes: payloadBytes + 256 };
}

class ManagedQQApi implements QQApi {
  readonly #raw: QQApi;
  readonly #observe: <T>(operation: () => Promise<T>, signal?: AbortSignal) => Promise<T>;
  readonly #run: <T>(
    bytes: number,
    run: (signal: AbortSignal) => Promise<T>,
    options: RequestOptions,
  ) => Promise<T>;
  readonly #control: <T>(
    bytes: number,
    run: (signal: AbortSignal) => Promise<T>,
    options: RequestOptions,
  ) => Promise<T>;
  constructor(
    raw: QQApi,
    observe: <T>(operation: () => Promise<T>, signal?: AbortSignal) => Promise<T>,
    run: <T>(
      bytes: number,
      run: (signal: AbortSignal) => Promise<T>,
      options: RequestOptions,
    ) => Promise<T>,
    control: <T>(
      bytes: number,
      run: (signal: AbortSignal) => Promise<T>,
      options: RequestOptions,
    ) => Promise<T>,
  ) {
    this.#raw = raw;
    this.#observe = observe;
    this.#run = run;
    this.#control = control;
  }
  readonly request = <T = unknown>(
    method: HttpMethod,
    path: string,
    input?: ApiRequestOptions,
  ): Promise<ApiResponse<T>> =>
    this.#observe(() => {
      const options = optionsSnapshot<ApiRequestOptions>(input);
      const { signal: _signal, query, body, ...rest } = options;
      void _signal;
      const clonedQuery = query === undefined ? undefined : structuredClone(query);
      const clonedBody = body === undefined ? undefined : structuredClone(body);
      const copied: ApiRequestOptions = {
        ...rest,
        ...(clonedQuery === undefined ? {} : { query: clonedQuery }),
        ...(clonedBody === undefined ? {} : { body: clonedBody }),
      };
      const bytes =
        (typeof path === 'string' ? Buffer.byteLength(path) : 0) +
        (clonedQuery === undefined ? 0 : Buffer.byteLength(JSON.stringify(clonedQuery))) +
        (clonedBody === undefined ? 0 : Buffer.byteLength(JSON.stringify(clonedBody))) +
        128;
      return this.#run(
        bytes,
        (signal) => this.#raw.request<T>(method, path, { ...copied, signal }),
        options,
      );
    }, input?.signal);
  readonly getSelf = (input?: RequestOptions): Promise<BotUser> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      return this.#run(128, (signal) => this.#raw.getSelf({ ...options, signal }), options);
    }, input?.signal);
  readonly getGateway = (input?: RequestOptions): Promise<{ url: string }> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      return this.#run(128, (signal) => this.#raw.getGateway({ ...options, signal }), options);
    }, input?.signal);
  readonly sendGroupMessage = (
    groupId: string,
    payload: QQMessagePayload,
    input?: RequestOptions,
  ): Promise<SendResult> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const copied = structuredClone(payload);
      const bytes =
        (typeof groupId === 'string' ? Buffer.byteLength(groupId) : 0) +
        Buffer.byteLength(JSON.stringify(copied)) +
        128;
      return this.#run(
        bytes,
        (signal) => this.#raw.sendGroupMessage(groupId, copied, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly sendPrivateMessage = (
    userId: string,
    payload: QQMessagePayload,
    input?: RequestOptions,
  ): Promise<SendResult> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const copied = structuredClone(payload);
      const bytes =
        (typeof userId === 'string' ? Buffer.byteLength(userId) : 0) +
        Buffer.byteLength(JSON.stringify(copied)) +
        128;
      return this.#run(
        bytes,
        (signal) => this.#raw.sendPrivateMessage(userId, copied, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly uploadGroupImage = (
    groupId: string,
    payload: QQUploadImagePayload,
    input?: RequestOptions,
  ): Promise<QQFileResult> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const { snapshot, bytes } = uploadSnapshot(payload);
      return this.#run(
        bytes,
        (signal) => this.#raw.uploadGroupImage(groupId, snapshot, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly uploadPrivateImage = (
    userId: string,
    payload: QQUploadImagePayload,
    input?: RequestOptions,
  ): Promise<QQFileResult> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const { snapshot, bytes } = uploadSnapshot(payload);
      return this.#run(
        bytes,
        (signal) => this.#raw.uploadPrivateImage(userId, snapshot, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly deleteGroupMessage = (
    groupId: string,
    messageId: string,
    input?: RequestOptions,
  ): Promise<void> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const bytes =
        (typeof groupId === 'string' ? Buffer.byteLength(groupId) : 0) +
        (typeof messageId === 'string' ? Buffer.byteLength(messageId) : 0) +
        128;
      return this.#run(
        bytes,
        (signal) => this.#raw.deleteGroupMessage(groupId, messageId, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly deletePrivateMessage = (
    userId: string,
    messageId: string,
    input?: RequestOptions,
  ): Promise<void> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const bytes =
        (typeof userId === 'string' ? Buffer.byteLength(userId) : 0) +
        (typeof messageId === 'string' ? Buffer.byteLength(messageId) : 0) +
        128;
      return this.#run(
        bytes,
        (signal) => this.#raw.deletePrivateMessage(userId, messageId, { ...options, signal }),
        options,
      );
    }, input?.signal);
  readonly acknowledgeInteraction = (
    interactionId: string,
    code = 0,
    input?: RequestOptions,
  ): Promise<void> =>
    this.#observe(() => {
      const options = optionsSnapshot(input);
      const bytes =
        (typeof interactionId === 'string' ? Buffer.byteLength(interactionId) : 0) + 128;
      return this.#control(
        bytes,
        (signal) => this.#raw.acknowledgeInteraction(interactionId, code, { ...options, signal }),
        options,
      );
    }, input?.signal);
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
    this.api = new ManagedQQApi(
      raw.api,
      (operation, signal) => this.observe(operation, signal),
      (bytes, run, options) => this.run(bytes, run, options),
      (bytes, run, options) => this.schedule(this.controls, bytes, run, options),
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
      const message = prepareMessage(input, this.config.api.maxUploadBytes);
      if (!isRecord(options))
        throw new FrameworkError('HANDLER_CONTRACT', 'Send options must be an object');
      const copied: SendOptions = {
        ...options,
        ...(options.reply
          ? { reply: { ...(options.reply as NonNullable<SendOptions['reply']>) } }
          : {}),
      };
      return this.run(
        message.bytes,
        (signal) => this.raw.sendPreparedMessage(target, message, { ...copied, signal }),
        copied,
      );
    }, options?.signal);
  }
  /** The event ledger already owns this snapshot and its errors. */
  sendPreparedMessage(
    target: MessageTarget,
    message: PreparedMessage,
    options: SendOptions,
  ): Promise<SendResult> {
    return this.run(
      message.bytes,
      (signal) => this.raw.sendPreparedMessage(target, message, { ...options, signal }),
      options,
    );
  }
  async sendAdmitted(
    targetInput: MessageTarget,
    message: PreparedMessage,
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
      const checked = prepareMessage(
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
        checked.bytes,
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
      const id = target.scene === 'group' ? target.groupId : target.userId;
      const bytes =
        Buffer.byteLength(id) +
        (typeof messageId === 'string' ? Buffer.byteLength(messageId) : 0) +
        128;
      return this.run(
        bytes,
        (signal) => this.raw.deleteMessage(target, messageId, { ...copied, signal }),
        copied,
      );
    }, options?.signal);
  }
}

class ScopedQQApi implements QQApi {
  readonly #api: QQApi;
  readonly #run: <T>(
    operation: (options: ApiRequestOptions) => Promise<T>,
    input?: ApiRequestOptions,
  ) => Promise<T>;
  constructor(
    api: QQApi,
    run: <T>(
      operation: (options: ApiRequestOptions) => Promise<T>,
      input?: ApiRequestOptions,
    ) => Promise<T>,
  ) {
    this.#api = api;
    this.#run = run;
  }
  readonly request = <T = unknown>(
    method: HttpMethod,
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<T>> =>
    this.#run((current) => this.#api.request<T>(method, path, current), options);
  readonly getSelf = (options?: RequestOptions): Promise<BotUser> =>
    this.#run((current) => this.#api.getSelf(current), options);
  readonly getGateway = (options?: RequestOptions): Promise<{ url: string }> =>
    this.#run((current) => this.#api.getGateway(current), options);
  readonly sendGroupMessage = (
    groupId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> =>
    this.#run((current) => this.#api.sendGroupMessage(groupId, payload, current), options);
  readonly sendPrivateMessage = (
    userId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> =>
    this.#run((current) => this.#api.sendPrivateMessage(userId, payload, current), options);
  readonly uploadGroupImage = (
    groupId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> =>
    this.#run((current) => this.#api.uploadGroupImage(groupId, payload, current), options);
  readonly uploadPrivateImage = (
    userId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> =>
    this.#run((current) => this.#api.uploadPrivateImage(userId, payload, current), options);
  readonly deleteGroupMessage = (
    groupId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> =>
    this.#run((current) => this.#api.deleteGroupMessage(groupId, messageId, current), options);
  readonly deletePrivateMessage = (
    userId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> =>
    this.#run((current) => this.#api.deletePrivateMessage(userId, messageId, current), options);
  readonly acknowledgeInteraction = (
    interactionId: string,
    code = 0,
    options?: RequestOptions,
  ): Promise<void> =>
    this.#run((current) => this.#api.acknowledgeInteraction(interactionId, code, current), options);
}

class ScopedQQClient implements QQClient {
  readonly #client: QQClient;
  readonly #run: <T>(
    operation: (options: SendOptions) => Promise<T>,
    input?: SendOptions,
  ) => Promise<T>;
  #api: QQApi | undefined;
  constructor(
    client: QQClient,
    run: <T>(operation: (options: SendOptions) => Promise<T>, input?: SendOptions) => Promise<T>,
  ) {
    this.#client = client;
    this.#run = run;
  }
  get api(): QQApi {
    return (this.#api ??= new ScopedQQApi(this.#client.api, this.#run));
  }
  readonly getSelf = (options?: RequestOptions): Promise<BotUser> =>
    this.#run((current) => this.#client.getSelf(current), options);
  readonly sendMessage = (
    target: MessageTarget,
    input: MessageInput,
    options?: SendOptions,
  ): Promise<SendResult> =>
    this.#run((current) => this.#client.sendMessage(target, input, current), options);
  readonly uploadImage = (
    target: MessageTarget,
    source: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage> =>
    this.#run((current) => this.#client.uploadImage(target, source, current), options);
  readonly deleteMessage = (
    target: MessageTarget,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> =>
    this.#run((current) => this.#client.deleteMessage(target, messageId, current), options);
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
      const options = optionsSnapshot<SendOptions>(input);
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
  return new ScopedQQClient(client, run);
}
