# 类型与接口

在这里查阅 dou-bot **0.6.0** 的函数签名、配置字段与返回类型。编写业务时从 `dou-bot` 导入，编写离线测试时从 `dou-bot/testing` 导入；需要了解用法时，先看 [装饰器参考](./decorators.md) 或 [完整示例](../examples/hello.md)。

## dou-bot

业务开发使用的装饰器、应用、消息工具与类型。

### AbstractType {#root-AbstractType}

```ts
export type AbstractType<T = object> = abstract new (...args: any[]) => T;
```

### AccessOptions {#root-AccessOptions}

```ts
export interface AccessOptions {
  /** Omit for the default denial hint; false denies silently. */
  message?: string | false;
}
```

### ApiRequestOptions {#root-ApiRequestOptions}

```ts
export interface ApiRequestOptions extends RequestOptions {
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: unknown;
}
```

### ApiResponse {#root-ApiResponse}

```ts
export interface ApiResponse<T> {
  readonly data: T;
  readonly status: number;
  readonly traceId?: string;
}
```

### ApplicationSnapshot {#root-ApplicationSnapshot}

```ts
export interface ApplicationSnapshot {
  status: ApplicationStatus;
  transport: 'ws' | 'webhook';
  prompts: {
    pending: number;
  };
  queue: {
    pending: number;
    active: number;
    retainedBytes: number;
  };
  events: {
    accepted: number;
    duplicates: number;
    rejected: number;
    failed: number;
  };
  lastEventAt?: number;
}
```

### ApplicationStatus {#root-ApplicationStatus}

```ts
export type ApplicationStatus =
  'created' | 'starting' | 'running' | 'reconnecting' | 'stopping' | 'stopped' | 'failed';
```

### Arg {#root-Arg}

```ts
export declare const Arg: (index: number, options?: ArgumentOptions) => ParameterDecorator;
```

### Args {#root-Args}

```ts
export declare const Args: () => ParameterDecorator;
```

### ArgumentOptions {#root-ArgumentOptions}

```ts
export type ArgumentOptions = ParameterDescription &
  (
    | {
        type?: 'string';
        default?: string;
        choices?: readonly string[];
        min?: never;
        max?: never;
      }
    | {
        type: 'integer' | 'number';
        default?: number;
        choices?: readonly number[];
        min?: number;
        max?: number;
      }
    | {
        type: 'boolean';
        default?: boolean;
        choices?: never;
        min?: never;
        max?: never;
      }
  );
```

### Attachment {#root-Attachment}

```ts
export interface Attachment {
  readonly url: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly raw: Readonly<Record<string, unknown>>;
}
```

### Awaitable {#root-Awaitable}

```ts
export type Awaitable<T> = T | Promise<T>;
```

### BotApplication {#root-BotApplication}

```ts
export interface BotApplication {
  readonly status: ApplicationStatus;
  readonly client: QQClient;
  start(): Promise<void>;
  close(): Promise<void>;
  get<T>(
    token: InjectionToken<T>,
    options?: {
      module?: Type;
    },
  ): T;
  webhookHandler(): RequestListener;
  snapshot(): ApplicationSnapshot;
}
```

### BotFactory {#root-BotFactory}

```ts
export declare const BotFactory: {
  create: (root: Type, options: BotOptions) => Promise<BotApplication>;
};
```

### BotOptions {#root-BotOptions}

```ts
export interface BotOptions {
  appId: string;
  secret: string;
  transport?: TransportOptions;
  api?: QQApiOptions;
  commands?: {
    /** Exact, case-sensitive prefix. Defaults to '/'; '' allows bare command names. No whitespace. */
    prefix?: string;
    /** Report all errors; optionally reply with safe command-input diagnostics. Defaults to 'report'. */
    invalidInput?: 'report' | 'reply';
  };
  execution?: ExecutionOptions;
  prompts?: PromptConfig;
  interactions?: {
    acknowledge?: 'auto' | 'manual';
  };
  logger?: Logger;
  onError?: ErrorHandler;
}
```

### BotUser {#root-BotUser}

```ts
export interface BotUser {
  readonly id: string;
  readonly username?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}
```

### button {#root-button}

```ts
export declare const button: {
  link: (label: string, url: string, options?: ButtonOptions) => KeyboardButton;
  command: (
    label: string,
    command: string,
    options?: ButtonOptions & {
      enter?: boolean;
    },
  ) => KeyboardButton;
  callback: (
    id: string,
    label: string,
    data?: string,
    options?: CallbackButtonOptions,
  ) => KeyboardButton;
};
```

### ButtonBase {#root-ButtonBase}

```ts
export interface ButtonBase {
  readonly label: string;
}
```

### ButtonContext {#root-ButtonContext}

```ts
export type ButtonContext = GroupButtonContext | PrivateButtonContext;
```

### ButtonContextBase {#root-ButtonContextBase}

```ts
export interface ButtonContextBase extends QQEventContext {
  readonly interactionId: string;
  readonly userId: string;
  readonly buttonId: string;
  readonly data: string;
  ack(code?: number): Promise<void>;
  send(message: MessageInput): Promise<SendResult>;
}
```

### ButtonOptions {#root-ButtonOptions}

```ts
export interface ButtonOptions {
  readonly id?: string;
  /** Label after clicking; defaults to the original label. An explicit '' is preserved. */
  readonly visitedLabel?: string;
  readonly style?: 'secondary' | 'primary';
  readonly permission?: ButtonPermission;
}
```

### ButtonPermission {#root-ButtonPermission}

```ts
export type ButtonPermission =
  | {
      readonly type: 'everyone';
    }
  | {
      /** QQ permission.type=1; only supported for group targets. */
      readonly type: 'managers';
    }
  | {
      readonly type: 'users';
      readonly userIds: readonly string[];
    };
```

### CallbackButtonOptions {#root-CallbackButtonOptions}

```ts
export type CallbackButtonOptions = Omit<ButtonOptions, 'id'> & {
  readonly id?: never;
};
```

### CanActivate {#root-CanActivate}

```ts
export interface CanActivate {
  canActivate(context: GuardContext): Awaitable<GuardResult>;
}
```

### ClassProvider {#root-ClassProvider}

```ts
export interface ClassProvider<T = unknown> {
  provide: InjectionToken<T>;
  useClass: Type<T>;
}
```

### Command {#root-Command}

```ts
export declare const Command: (name: string, options?: CommandOptions) => MethodDecorator;
```

### CommandOptions {#root-CommandOptions}

```ts
export interface CommandOptions {
  aliases?: readonly string[];
  description?: string;
}
```

### CommandReturn {#root-CommandReturn}

```ts
export type CommandReturn = MessageInput | void;
```

### Controller {#root-Controller}

```ts
export declare function Controller(): ClassDecorator;
```

### Cooldown {#root-Cooldown}

```ts
export declare function Cooldown(options: CooldownOptions): MethodDecorator;
```

### CooldownOptions {#root-CooldownOptions}

```ts
export interface CooldownOptions {
  /** Per route: user within a session, whole session, or all callers of the command/button. */
  scope: 'user' | 'session' | 'command';
  durationMs: number;
  /** Omit for a remaining-time hint; false suppresses the hint. */
  message?: string | false;
}
```

### Ctx {#root-Ctx}

```ts
export declare const Ctx: () => ParameterDecorator;
```

### ErrorContext {#root-ErrorContext}

```ts
export interface ErrorContext {
  readonly phase: ErrorPhase;
  readonly appId: string;
  readonly eventName?: string;
  readonly eventId?: string;
  readonly messageId?: string;
  readonly controller?: string;
  readonly method?: string;
}
```

### ErrorHandler {#root-ErrorHandler}

```ts
export type ErrorHandler = (error: Error, context: ErrorContext) => Awaitable<void>;
```

### ErrorPhase {#root-ErrorPhase}

```ts
export type ErrorPhase =
  | 'prompt'
  | 'guard'
  | 'cooldown'
  | 'bootstrap'
  | 'transport'
  | 'protocol'
  | 'queue'
  | 'observer'
  | 'command'
  | 'button'
  | 'interaction-ack'
  | 'send'
  | 'shutdown';
```

### ExecutionOptions {#root-ExecutionOptions}

```ts
export interface ExecutionOptions {
  concurrency?: number;
  queueCapacity?: number;
  maxEventBytes?: number;
  queueMaxBytes?: number;
  dedupMaxEntries?: number;
  dedupTtlMs?: number;
  replyScopeMaxEntries?: number;
  replyScopeTtlMs?: number;
  maxContextOperations?: number;
  errorHandlerTimeoutMs?: number;
  shutdownTimeoutMs?: number;
  cooldownMaxEntries?: number;
}
```

### FactoryProvider {#root-FactoryProvider}

```ts
export interface FactoryProvider<T = unknown> {
  provide: InjectionToken<T>;
  inject?: readonly InjectionToken[];
  useFactory: (...dependencies: any[]) => Awaitable<T>;
}
```

### FrameworkError {#root-FrameworkError}

```ts
export declare class FrameworkError extends Error {
  readonly code: FrameworkErrorCode;
  readonly name: string;
  constructor(code: FrameworkErrorCode, message: string, options?: ErrorOptions);
}
```

### FrameworkErrorCode {#root-FrameworkErrorCode}

```ts
export type FrameworkErrorCode =
  | 'CONFIG'
  | 'DEPENDENCY'
  | 'ROUTE_CONFLICT'
  | 'PARAMETER_PARSE'
  | 'HANDLER_CONTRACT'
  | 'PROTOCOL'
  | 'TRANSPORT'
  | 'QQ_API'
  | 'QUEUE_FULL'
  | 'INVALID_STATE'
  | 'RESOURCE_LIMIT'
  | 'SHUTDOWN_TIMEOUT'
  | 'CLEANUP_FAILED';
```

### GroupButtonContext {#root-GroupButtonContext}

```ts
export interface GroupButtonContext extends ButtonContextBase {
  readonly scene: 'group';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'group';
    }
  >;
}
```

### GroupManagersOnly {#root-GroupManagersOnly}

```ts
export declare function GroupManagersOnly(
  options?: AccessOptions,
): ClassDecorator & MethodDecorator;
```

### GroupMessageContext {#root-GroupMessageContext}

```ts
export interface GroupMessageContext extends MessageContextBase {
  readonly scene: 'group';
  readonly groupId: string;
  readonly memberRole?: GroupRole;
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'group';
    }
  >;
}
```

### GroupOnly {#root-GroupOnly}

```ts
export declare function GroupOnly(options?: AccessOptions): ClassDecorator & MethodDecorator;
```

### GroupRole {#root-GroupRole}

```ts
export type GroupRole = 'member' | 'admin' | 'owner';
```

### GroupRoles {#root-GroupRoles}

```ts
export declare function GroupRoles(
  ...roles: readonly GroupRole[]
): ClassDecorator & MethodDecorator;
```

### GuardContext {#root-GuardContext}

```ts
export type GuardContext = Omit<QQEventContext, 'client'> & {
  readonly userId: string;
  readonly controller: Type;
  readonly method: string;
  /** Canonical command name or button ID, independent of the alias used. */
  readonly route: string;
} & (
    | {
        readonly scene: 'group';
        readonly groupId: string;
        /** Present only for group message commands with a recognized author role. */
        readonly memberRole?: GroupRole;
        readonly target: Extract<
          MessageTarget,
          {
            scene: 'group';
          }
        >;
      }
    | {
        readonly scene: 'private';
        readonly target: Extract<
          MessageTarget,
          {
            scene: 'private';
          }
        >;
      }
  ) &
  (
    | {
        readonly kind: 'command';
        readonly messageId: string;
        readonly content: string;
        readonly attachments: readonly Attachment[];
      }
    | {
        readonly kind: 'button';
        readonly interactionId: string;
        readonly buttonId: string;
        readonly data: string;
      }
  );
```

### GuardResult {#root-GuardResult}

```ts
export type GuardResult =
  | boolean
  | {
      readonly allow: false;
      readonly message?: string;
    };
```

### HelpModule {#root-HelpModule}

```ts
export declare class HelpModule {}
```

### HttpMethod {#root-HttpMethod}

```ts
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
```

### image {#root-image}

```ts
export declare const image: (
  source: ImageSource,
  options?: {
    caption?: string;
  },
) => ImageMessage;
```

### ImageMessage {#root-ImageMessage}

```ts
export interface ImageMessage {
  readonly kind: 'image';
  readonly source: ImageSource;
  readonly caption?: string;
}
```

### ImageSource {#root-ImageSource}

```ts
export type ImageSource = string | Uint8Array | UploadedImage;
```

### Inject {#root-Inject}

```ts
export declare function Inject(token: InjectionToken): ParameterDecorator;
```

### Injectable {#root-Injectable}

```ts
export declare function Injectable(): ClassDecorator;
```

### InjectionToken {#root-InjectionToken}

```ts
export type InjectionToken<T = unknown> = Type<T> | AbstractType<T> | string | symbol;
```

### keyboard {#root-keyboard}

```ts
export declare const keyboard: (rows: readonly (readonly KeyboardButton[])[]) => Keyboard;
```

### Keyboard {#root-Keyboard}

```ts
export interface Keyboard {
  readonly kind: 'inline';
  readonly rows: readonly (readonly KeyboardButton[])[];
  readonly id?: never;
}
```

### KeyboardButton {#root-KeyboardButton}

```ts
export type KeyboardButton =
  | (ButtonBase & {
      readonly type: 'link';
      readonly url: string;
      readonly options?: ButtonOptions;
    })
  | (ButtonBase & {
      readonly type: 'command';
      readonly command: string;
      readonly enter: boolean;
      readonly options?: ButtonOptions;
    })
  | (ButtonBase & {
      readonly type: 'callback';
      readonly id: string;
      readonly data: string;
      readonly options?: CallbackButtonOptions;
    });
```

### Logger {#root-Logger}

```ts
export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}
```

### LOGGER {#root-LOGGER}

```ts
export declare const LOGGER: unique symbol;
```

### markdown {#root-markdown}

```ts
export declare const markdown: (
  content: string,
  options?: {
    keyboard?: Keyboard;
  },
) => MarkdownMessage;
```

### MarkdownBody {#root-MarkdownBody}

```ts
export interface MarkdownBody {
  readonly content: string;
  readonly templateId?: never;
  readonly params?: never;
}
```

### MarkdownMessage {#root-MarkdownMessage}

```ts
export interface MarkdownMessage {
  readonly kind: 'markdown';
  readonly body: MarkdownBody;
  readonly keyboard?: Keyboard;
}
```

### MessageContext {#root-MessageContext}

```ts
export type MessageContext = GroupMessageContext | PrivateMessageContext;
```

### MessageContextBase {#root-MessageContextBase}

```ts
export interface MessageContextBase extends QQEventContext {
  readonly messageId: string;
  readonly userId: string;
  /** Group content omits leading mentions explicitly marked as this bot; raw.d is unchanged. */
  readonly content: string;
  readonly timestamp?: number;
  readonly attachments: readonly Attachment[];
  reply(message: MessageInput): Promise<SendResult>;
  send(message: MessageInput): Promise<SendResult>;
  /** Ask and await this user's next message. Always await; replies are owned by this workflow. */
  prompt(question: MessageInput, options?: PromptOptions): Promise<PromptResult>;
}
```

### MessageInput {#root-MessageInput}

```ts
export type MessageInput = string | OutgoingMessage;
```

### MessageTarget {#root-MessageTarget}

```ts
export type MessageTarget =
  | {
      readonly scene: 'group';
      readonly groupId: string;
    }
  | {
      readonly scene: 'private';
      readonly userId: string;
    };
```

### Module {#root-Module}

```ts
export declare function Module(data: ModuleMetadata): ClassDecorator;
```

### ModuleMetadata {#root-ModuleMetadata}

```ts
export interface ModuleMetadata {
  imports?: readonly Type[];
  controllers?: readonly Type[];
  providers?: readonly Provider[];
  exports?: readonly InjectionToken[];
  /** Applied to this module's own controllers before class/method guards; imports are independent. */
  guards?: readonly InjectionToken<CanActivate>[];
}
```

### On {#root-On}

```ts
export declare const On: (eventName: string) => MethodDecorator;
```

### OnButton {#root-OnButton}

```ts
export declare const OnButton: (buttonId: string) => MethodDecorator;
```

### OnModuleDestroy {#root-OnModuleDestroy}

```ts
export interface OnModuleDestroy {
  onModuleDestroy(signal: AbortSignal): Awaitable<void>;
}
```

### OnModuleInit {#root-OnModuleInit}

```ts
export interface OnModuleInit {
  onModuleInit(signal: AbortSignal): Awaitable<void>;
}
```

### Option {#root-Option}

```ts
export declare const Option: (name: string, options?: OptionOptions) => ParameterDecorator;
```

### OptionOptions {#root-OptionOptions}

```ts
export type OptionOptions = ArgumentOptions & {
  alias?: string;
};
```

### OutgoingMessage {#root-OutgoingMessage}

```ts
export type OutgoingMessage = TextMessage | ImageMessage | MarkdownMessage;
```

### ParameterDescription {#root-ParameterDescription}

```ts
export interface ParameterDescription {
  name?: string;
  description?: string;
  required?: boolean;
}
```

### PrivateButtonContext {#root-PrivateButtonContext}

```ts
export interface PrivateButtonContext extends ButtonContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'private';
    }
  >;
}
```

### PrivateMessageContext {#root-PrivateMessageContext}

```ts
export interface PrivateMessageContext extends MessageContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'private';
    }
  >;
}
```

### PrivateOnly {#root-PrivateOnly}

```ts
export declare function PrivateOnly(options?: AccessOptions): ClassDecorator & MethodDecorator;
```

### PromptConfig {#root-PromptConfig}

```ts
export interface PromptConfig extends PromptOptions {
  /** Includes questions being sent and continuations awaiting an execution slot. Default 1000. */
  maxPending?: number;
  /** Upper bound for a per-call timeout. Default 300000 ms. */
  maxTimeoutMs?: number;
}
```

### PromptMessage {#root-PromptMessage}

```ts
export type PromptMessage = MessageContext;
```

### PromptOptions {#root-PromptOptions}

```ts
export interface PromptOptions {
  /** Wait duration after QQ accepts the question; defaults to the application setting. */
  timeoutMs?: number;
  /** Exact, case-sensitive matches against trimmed input. [] disables cancellation words. */
  cancelWords?: readonly string[];
}
```

### PromptResult {#root-PromptResult}

```ts
export type PromptResult =
  | {
      readonly status: 'received';
      readonly message: PromptMessage;
    }
  | {
      readonly status: 'timeout';
    }
  | {
      readonly status: 'cancelled';
    };
```

### Provider {#root-Provider}

```ts
export type Provider = Type | ClassProvider | ValueProvider | FactoryProvider;
```

### QQApi {#root-QQApi}

```ts
export declare abstract class QQApi {
  abstract request<T = unknown>(
    method: HttpMethod,
    path: string,
    options?: ApiRequestOptions,
  ): Promise<ApiResponse<T>>;
  abstract getSelf(options?: RequestOptions): Promise<BotUser>;
  abstract getGateway(options?: RequestOptions): Promise<{
    url: string;
  }>;
  abstract sendGroupMessage(
    groupId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult>;
  abstract sendPrivateMessage(
    userId: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult>;
  abstract uploadGroupImage(
    groupId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult>;
  abstract uploadPrivateImage(
    userId: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult>;
  abstract deleteGroupMessage(
    groupId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void>;
  abstract deletePrivateMessage(
    userId: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void>;
  abstract acknowledgeInteraction(
    interactionId: string,
    code?: number,
    options?: RequestOptions,
  ): Promise<void>;
}
```

### QQApiError {#root-QQApiError}

```ts
export declare class QQApiError extends FrameworkError {
  readonly name = 'QQApiError';
  readonly httpStatus?: number;
  readonly qqCode?: number | string;
  readonly traceId?: string;
  readonly method: HttpMethod;
  readonly path: string;
  constructor(
    message: string,
    details: {
      method: HttpMethod;
      path: string;
      httpStatus?: number;
      qqCode?: number | string;
      traceId?: string;
      cause?: unknown;
    },
  );
}
```

### QQApiOptions {#root-QQApiOptions}

```ts
export interface QQApiOptions {
  baseUrl?: string;
  tokenEndpoint?: string;
  sandbox?: boolean;
  requestTimeoutMs?: number;
  maxUploadBytes?: number;
  maxResponseBytes?: number;
}
```

### QQClient {#root-QQClient}

```ts
export declare abstract class QQClient {
  abstract readonly api: QQApi;
  abstract getSelf(options?: RequestOptions): Promise<BotUser>;
  abstract sendMessage(
    target: MessageTarget,
    message: MessageInput,
    options?: SendOptions,
  ): Promise<SendResult>;
  abstract uploadImage(
    target: MessageTarget,
    source: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage>;
  abstract deleteMessage(
    target: MessageTarget,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void>;
}
```

### QQDispatch {#root-QQDispatch}

```ts
export interface QQDispatch<T = unknown> {
  readonly op: 0;
  readonly t: string;
  readonly d: T;
  readonly id?: string;
  readonly s?: number;
}
```

### QQEventContext {#root-QQEventContext}

```ts
export interface QQEventContext<T = unknown> {
  readonly appId: string;
  readonly eventName: string;
  readonly eventId?: string;
  readonly receivedAt: number;
  readonly raw: QQDispatch<T>;
  readonly signal: AbortSignal;
  readonly client: QQClient;
}
```

### QQFileResult {#root-QQFileResult}

```ts
export interface QQFileResult {
  file_info: string;
  file_uuid?: string;
  ttl?: number;
}
```

### QQInlineKeyboardPayload {#root-QQInlineKeyboardPayload}

```ts
export interface QQInlineKeyboardPayload {
  rows: readonly {
    buttons: readonly {
      id?: string;
      render_data: {
        label: string;
        visited_label?: string;
        style?: number;
      };
      action: {
        type: number;
        data: string;
        enter?: boolean;
        permission: {
          type: number;
          specify_user_ids?: readonly string[];
        };
      };
    }[];
  }[];
}
```

### QQKeyboardPayload {#root-QQKeyboardPayload}

```ts
export interface QQKeyboardPayload {
  id?: never;
  content: QQInlineKeyboardPayload;
}
```

### QQMarkdownPayload {#root-QQMarkdownPayload}

```ts
export interface QQMarkdownPayload {
  content: string;
  custom_template_id?: never;
  params?: never;
}
```

### QQMessagePayload {#root-QQMessagePayload}

```ts
export type QQMessagePayload = QQReplyFields &
  (
    | {
        msg_type: 0;
        content: string;
        markdown?: never;
        keyboard?: never;
        media?: never;
      }
    | {
        msg_type: 2;
        content?: never;
        markdown: QQMarkdownPayload;
        keyboard?: QQKeyboardPayload;
        media?: never;
      }
    | {
        msg_type: 7;
        content?: string;
        markdown?: never;
        keyboard?: never;
        media: {
          file_info: string;
        };
      }
  );
```

### QQReplyFields {#root-QQReplyFields}

```ts
export type QQReplyFields =
  | {
      msg_id: string;
      msg_seq: number;
      event_id?: never;
    }
  | {
      event_id: string;
      msg_id?: never;
      msg_seq?: never;
    }
  | {
      msg_id?: never;
      msg_seq?: never;
      event_id?: never;
    };
```

### QQUploadImagePayload {#root-QQUploadImagePayload}

```ts
export type QQUploadImagePayload = {
  file_type: 1;
  srv_send_msg: false;
} & (
  | {
      url: string;
      file_data?: never;
    }
  | {
      url?: never;
      file_data: string;
    }
);
```

### ReplyReference {#root-ReplyReference}

```ts
export interface ReplyReference {
  messageId: string;
  sequence: number;
}
```

### RequestOptions {#root-RequestOptions}

```ts
export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
```

### Rest {#root-Rest}

```ts
export declare const Rest: (options?: RestOptions) => ParameterDecorator;
```

### RestOptions {#root-RestOptions}

```ts
export interface RestOptions {
  name?: string;
  description?: string;
}
```

### RetryOptions {#root-RetryOptions}

```ts
export interface RetryOptions {
  initialAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}
```

### SendOptions {#root-SendOptions}

```ts
export interface SendOptions extends RequestOptions {
  reply?: ReplyReference;
}
```

### SendResult {#root-SendResult}

```ts
export type SendResult =
  | {
      readonly status: 'sent';
      readonly messageId: string;
      readonly timestamp?: number;
      readonly traceId?: string;
      readonly raw: Readonly<Record<string, unknown>>;
    }
  | {
      readonly status: 'pending-audit';
      readonly auditId: string;
      readonly messageId?: string;
      readonly traceId?: string;
      readonly raw: Readonly<Record<string, unknown>>;
    };
```

### Slot {#root-Slot}

```ts
export declare const Slot: (name: string, options: SlotOptions) => ParameterDecorator;
```

### SlotOptions {#root-SlotOptions}

```ts
export type SlotOptions = ParameterDescription & {
  default?: string;
} & (
    | {
        choices: readonly string[];
        match?: (text: string) => boolean;
      }
    | {
        match: (text: string) => boolean;
        choices?: readonly string[];
      }
  );
```

### text {#root-text}

```ts
export declare const text: (content: string) => TextMessage;
```

### TextMessage {#root-TextMessage}

```ts
export interface TextMessage {
  readonly kind: 'text';
  readonly content: string;
}
```

### TransportOptions {#root-TransportOptions}

```ts
export type TransportOptions = WsTransportOptions | WebhookTransportOptions;
```

### Type {#root-Type}

```ts
export type Type<T = object> = new (...args: any[]) => T;
```

### UploadedImage {#root-UploadedImage}

```ts
export interface UploadedImage {
  readonly kind: 'uploaded-image';
  readonly appId: string;
  readonly apiOrigin: string;
  readonly target: MessageTarget;
  readonly fileInfo: string;
  readonly fileUuid?: string;
  readonly expiresAt?: number;
}
```

### UseGuards {#root-UseGuards}

```ts
export declare function UseGuards(
  ...guards: readonly InjectionToken<CanActivate>[]
): ClassDecorator & MethodDecorator;
```

### UsersOnly {#root-UsersOnly}

```ts
export declare function UsersOnly(
  userIds: readonly string[],
  options?: UsersOnlyOptions,
): ClassDecorator & MethodDecorator;
```

### UsersOnlyOptions {#root-UsersOnlyOptions}

```ts
export interface UsersOnlyOptions extends AccessOptions {
  /** Compare OpenIDs only in this scene when supplied. */
  scene?: 'group' | 'private';
  /** Restrict to one group; implies scene=group. */
  groupId?: string;
}
```

### ValueProvider {#root-ValueProvider}

```ts
export interface ValueProvider<T = unknown> {
  provide: InjectionToken<T>;
  useValue: T;
}
```

### WebhookTransportOptions {#root-WebhookTransportOptions}

```ts
export interface WebhookTransportOptions {
  type: 'webhook';
  listen?: boolean;
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  readTimeoutMs?: number;
  maxConcurrentRequests?: number;
  maxSignatureAgeMs?: number;
  gatewayUrl?: never;
  intents?: never;
  heartbeatSequenceField?: never;
  connectTimeoutMs?: never;
  closeTimeoutMs?: never;
  retry?: never;
}
```

### WsTransportOptions {#root-WsTransportOptions}

```ts
export interface WsTransportOptions {
  type: 'ws';
  gatewayUrl?: string;
  intents?: number;
  heartbeatSequenceField?: 's' | 'd';
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
  retry?: RetryOptions;
  listen?: never;
  host?: never;
  port?: never;
  path?: never;
  maxBodyBytes?: never;
  readTimeoutMs?: never;
  maxConcurrentRequests?: never;
  maxSignatureAgeMs?: never;
}
```

## dou-bot/testing

在本地运行模块、投递模拟事件并检查处理结果的测试工具与类型。

### createTestApplication {#testing-createTestApplication}

```ts
export declare function createTestApplication(
  root: Type,
  options?: TestOptions,
): Promise<TestHarness>;
```

### RecordedMessage {#testing-RecordedMessage}

```ts
export interface RecordedMessage {
  target: MessageTarget;
  payload: QQMessagePayload;
}
```

### TestHarness {#testing-TestHarness}

提供 app、messages、acknowledgments、errors、enqueue、dispatch 和 flush。接纳结果为结构化返回值，详情见 [测试入口 API](./testing.md#testharness)。

### TestOptions {#testing-TestOptions}

```ts
export interface TestOptions extends Omit<BotOptions, 'appId' | 'secret' | 'transport'> {
  appId?: string;
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
```

### TestRequest {#testing-TestRequest}

```ts
export interface TestRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}
```
