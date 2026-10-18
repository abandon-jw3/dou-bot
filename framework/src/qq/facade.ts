import type {
  HttpMethod,
  ApiRequestOptions,
  ApiResponse,
  BotUser,
  MessageInput,
  MessageTarget,
  QQApi,
  QQClient,
  QQFileResult,
  RequestOptions,
  SendOptions,
  SendResult,
  UploadedImage,
} from '../contracts.js';

export type ApiMethod = keyof QQApi;
export type ClientMethod = Exclude<keyof QQClient, 'api'>;
export type ApiCall = <T>(
  method: ApiMethod,
  args: readonly unknown[],
  options?: ApiRequestOptions,
) => Promise<T>;
export type ClientCall = <T>(
  method: ClientMethod,
  args: readonly unknown[],
  options?: SendOptions,
) => Promise<T>;

/** Explicit signatures keep optional argument positions and make new API methods a compile-time obligation. */
export function apiFacade(call: ApiCall): QQApi {
  return Object.freeze({
    request: <T>(method: HttpMethod, path: string, options?: ApiRequestOptions) =>
      call<ApiResponse<T>>('request', [method, path], options),
    getSelf: (options) => call<BotUser>('getSelf', [], options),
    getGateway: (options) => call<{ url: string }>('getGateway', [], options),
    sendGroupMessage: (groupId, payload, options) =>
      call<SendResult>('sendGroupMessage', [groupId, payload], options),
    sendPrivateMessage: (userId, payload, options) =>
      call<SendResult>('sendPrivateMessage', [userId, payload], options),
    uploadGroupImage: (groupId, payload, options) =>
      call<QQFileResult>('uploadGroupImage', [groupId, payload], options),
    uploadPrivateImage: (userId, payload, options) =>
      call<QQFileResult>('uploadPrivateImage', [userId, payload], options),
    deleteGroupMessage: (groupId, messageId, options) =>
      call<void>('deleteGroupMessage', [groupId, messageId], options),
    deletePrivateMessage: (userId, messageId, options) =>
      call<void>('deletePrivateMessage', [userId, messageId], options),
    acknowledgeInteraction: (interactionId, code = 0, options) =>
      call<void>('acknowledgeInteraction', [interactionId, code], options),
  } satisfies QQApi);
}

/** The API object is lazy: ordinary contexts need no HTTP facade allocations. */
export function clientFacade(call: ClientCall, api: () => QQApi): QQClient {
  let cached: QQApi | undefined;
  return Object.freeze({
    get api() {
      return (cached ??= api());
    },
    getSelf: (options?: RequestOptions) => call<BotUser>('getSelf', [], options),
    sendMessage: (target: MessageTarget, input: MessageInput, options?: SendOptions) =>
      call<SendResult>('sendMessage', [target, input], options),
    uploadImage: (target: MessageTarget, source: string | Uint8Array, options?: RequestOptions) =>
      call<UploadedImage>('uploadImage', [target, source], options),
    deleteMessage: (target: MessageTarget, messageId: string, options?: RequestOptions) =>
      call<void>('deleteMessage', [target, messageId], options),
  } satisfies QQClient);
}

// Only the public method unions enter these two dispatchers; private runtime fields never escape a facade.
export function invokeApi<T>(
  api: QQApi,
  method: ApiMethod,
  args: readonly unknown[],
  options?: ApiRequestOptions,
): Promise<T> {
  return (api[method] as (...values: unknown[]) => Promise<T>).apply(api, [...args, options]);
}
export function invokeClient<T>(
  client: QQClient,
  method: ClientMethod,
  args: readonly unknown[],
  options?: SendOptions,
): Promise<T> {
  return (client[method] as (...values: unknown[]) => Promise<T>).apply(client, [...args, options]);
}
export function accountClient(resolve: () => QQClient): QQClient {
  return clientFacade(
    <T>(method: ClientMethod, args: readonly unknown[], options?: SendOptions) =>
      invokeClient<T>(resolve(), method, args, options),
    () =>
      apiFacade(<T>(method: ApiMethod, args: readonly unknown[], options?: ApiRequestOptions) =>
        invokeApi<T>(resolve().api, method, args, options),
      ),
  );
}
