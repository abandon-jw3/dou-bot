import type {
  ApiRequestOptions,
  ApiResponse,
  BotUser,
  HttpMethod,
  MessageInput,
  MessageTarget,
  QQApi,
  QQClient,
  QQFileResult,
  QQMessagePayload,
  QQUploadImagePayload,
  RequestOptions,
  SendOptions,
  SendResult,
  UploadedImage,
} from '../contracts.js';

/** Thin #private facade so callers can detach methods while runtime internals stay inaccessible. */
class AccountQQApi implements QQApi {
  readonly #resolve: () => QQApi;
  constructor(resolve: () => QQApi) {
    this.#resolve = resolve;
  }
  readonly request = <T = unknown>(
    method: HttpMethod,
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<T>> => this.#resolve().request<T>(method, path, options);
  readonly getSelf = (options?: RequestOptions): Promise<BotUser> =>
    this.#resolve().getSelf(options);
  readonly getGateway = (options?: RequestOptions): Promise<{ url: string }> =>
    this.#resolve().getGateway(options);
  readonly sendGroupMessage = (
    groupId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> => this.#resolve().sendGroupMessage(groupId, payload, options);
  readonly sendPrivateMessage = (
    userId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> => this.#resolve().sendPrivateMessage(userId, payload, options);
  readonly uploadGroupImage = (
    groupId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> => this.#resolve().uploadGroupImage(groupId, payload, options);
  readonly uploadPrivateImage = (
    userId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> => this.#resolve().uploadPrivateImage(userId, payload, options);
  readonly deleteGroupMessage = (
    groupId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> => this.#resolve().deleteGroupMessage(groupId, messageId, options);
  readonly deletePrivateMessage = (
    userId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> => this.#resolve().deletePrivateMessage(userId, messageId, options);
  readonly acknowledgeInteraction = (
    interactionId: string,
    code = 0,
    options?: RequestOptions,
  ): Promise<void> => this.#resolve().acknowledgeInteraction(interactionId, code, options);
}

class AccountQQClient implements QQClient {
  readonly #resolve: () => QQClient;
  #api: QQApi | undefined;
  constructor(resolve: () => QQClient) {
    this.#resolve = resolve;
  }
  get api(): QQApi {
    return (this.#api ??= new AccountQQApi(() => this.#resolve().api));
  }
  readonly getSelf = (options?: RequestOptions): Promise<BotUser> =>
    this.#resolve().getSelf(options);
  readonly sendMessage = (
    target: MessageTarget,
    input: MessageInput,
    options?: SendOptions,
  ): Promise<SendResult> => this.#resolve().sendMessage(target, input, options);
  readonly uploadImage = (
    target: MessageTarget,
    source: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage> => this.#resolve().uploadImage(target, source, options);
  readonly deleteMessage = (
    target: MessageTarget,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> => this.#resolve().deleteMessage(target, messageId, options);
}

export function accountClient(resolve: () => QQClient): QQClient {
  return new AccountQQClient(resolve);
}
