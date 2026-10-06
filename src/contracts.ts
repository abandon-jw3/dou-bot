/* eslint-disable @typescript-eslint/no-explicit-any -- Public DI constructor/factory signatures accept consumer-defined parameter lists. */
import type { RequestListener } from 'node:http';

export type Awaitable<T> = T | Promise<T>;

export type Type<T = object> = new (...args: any[]) => T;

export type AbstractType<T = object> = abstract new (...args: any[]) => T;

export type InjectionToken<T = unknown> = Type<T> | AbstractType<T> | string | symbol;

export interface ClassProvider<T = unknown> {
  provide: InjectionToken<T>;
  useClass: Type<T>;
}

export interface ValueProvider<T = unknown> {
  provide: InjectionToken<T>;
  useValue: T;
}

export interface FactoryProvider<T = unknown> {
  provide: InjectionToken<T>;
  inject?: readonly InjectionToken[];
  useFactory: (...dependencies: any[]) => Awaitable<T>;
}

export type Provider = Type | ClassProvider | ValueProvider | FactoryProvider;

export interface ModuleMetadata {
  imports?: readonly Type[];
  controllers?: readonly Type[];
  providers?: readonly Provider[];
  exports?: readonly InjectionToken[];
  /** Applied to this module's own controllers before class/method guards; imports are independent. */
  guards?: readonly InjectionToken<CanActivate>[];
}

export interface OnModuleInit {
  onModuleInit(signal: AbortSignal): Awaitable<void>;
}

export interface OnModuleDestroy {
  onModuleDestroy(signal: AbortSignal): Awaitable<void>;
}

export interface CommandOptions {
  aliases?: readonly string[];
  description?: string;
}

export type GuardResult = boolean | { readonly allow: false; readonly message?: string };

/** QQ group message author.member_role; missing/unknown values remain undefined. */
export type GroupRole = 'member' | 'admin' | 'owner';
/** Frozen snapshot of the current sender or button operator; IDs are scene-specific OpenIDs. */
export interface UserInfo {
  readonly id: string;
  readonly username?: string;
  readonly bot?: boolean;
  readonly memberRole?: GroupRole;
}
/** Frozen group identity from the current event; id is an OpenID, not a displayed group number. */
export interface GroupInfo {
  readonly id: string;
}
export interface AccessOptions {
  /** Omit for the default denial hint; false denies silently. */
  message?: string | false;
}
export interface UsersOnlyOptions extends AccessOptions {
  /** Compare OpenIDs only in this scene when supplied. */
  scene?: 'group' | 'private';
  /** Restrict to one group; implies scene=group. */
  groupId?: string;
}

/** Read-only request information. Return a decision instead of sending messages from a guard. */
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
        readonly target: Extract<MessageTarget, { scene: 'group' }>;
      }
    | { readonly scene: 'private'; readonly target: Extract<MessageTarget, { scene: 'private' }> }
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

export interface CanActivate {
  canActivate(context: GuardContext): Awaitable<GuardResult>;
}

export interface CooldownOptions {
  /** Per route: user within a session, whole session, or all callers of the command/button. */
  scope: 'user' | 'session' | 'command';
  durationMs: number;
  /** Omit for a remaining-time hint; false suppresses the hint. */
  message?: string | false;
}

export interface ParameterDescription {
  name?: string;
  description?: string;
  required?: boolean;
}

/** Runtime conversion is explicit; TypeScript parameter annotations are not inspected. */
export type ArgumentOptions = ParameterDescription &
  (
    | { type?: 'string'; default?: string; choices?: readonly string[]; min?: never; max?: never }
    | {
        type: 'integer' | 'number';
        default?: number;
        choices?: readonly number[];
        min?: number;
        max?: number;
      }
    | { type: 'boolean'; default?: boolean; choices?: never; min?: never; max?: never }
  );

export type OptionOptions = ArgumentOptions & { alias?: string };

/** Matchers must be pure, synchronous predicates. When supplied together, both rules must match. */
export type SlotOptions = ParameterDescription & { default?: string } & (
    | { choices: readonly string[]; match?: (text: string) => boolean }
    | { match: (text: string) => boolean; choices?: readonly string[] }
  );

export interface RestOptions {
  name?: string;
  description?: string;
}

/** Counts apply to the selected top-level attachments of the current message. */
export interface AttachmentOptions {
  name?: string;
  description?: string;
  minCount?: number;
  maxCount?: number;
}

export interface RetryOptions {
  initialAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

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

export type TransportOptions = WsTransportOptions | WebhookTransportOptions;

export interface QQApiOptions {
  baseUrl?: string;
  tokenEndpoint?: string;
  sandbox?: boolean;
  requestTimeoutMs?: number;
  maxUploadBytes?: number;
  maxResponseBytes?: number;
}

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

export type ApplicationStatus =
  'created' | 'starting' | 'running' | 'reconnecting' | 'stopping' | 'stopped' | 'failed';

export interface ApplicationSnapshot {
  status: ApplicationStatus;
  transport: 'ws' | 'webhook';
  prompts: { pending: number };
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

export type MessageTarget =
  | {
      readonly scene: 'group';
      readonly groupId: string;
    }
  | {
      readonly scene: 'private';
      readonly userId: string;
    };

export interface QQDispatch<T = unknown> {
  readonly op: 0;
  readonly t: string;
  readonly d: T;
  readonly id?: string;
  readonly s?: number;
}

export interface Attachment {
  readonly url: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly width?: number;
  readonly height?: number;
  readonly voiceWavUrl?: string;
  readonly asrReferText?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface QQEventContext<T = unknown> {
  readonly appId: string;
  readonly eventName: string;
  readonly eventId?: string;
  readonly receivedAt: number;
  readonly raw: QQDispatch<T>;
  readonly signal: AbortSignal;
  readonly client: QQClient;
}

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

export interface PromptOptions {
  /** Wait duration after QQ accepts the question; defaults to the application setting. */
  timeoutMs?: number;
  /** Exact, case-sensitive matches against trimmed input. [] disables cancellation words. */
  cancelWords?: readonly string[];
}
export interface PromptConfig extends PromptOptions {
  /** Includes questions being sent and continuations awaiting an execution slot. Default 1000. */
  maxPending?: number;
  /** Upper bound for a per-call timeout. Default 300000 ms. */
  maxTimeoutMs?: number;
}
/** Valid until the original command finishes; reply/prompt use this input's message reference. */
export type PromptMessage = MessageContext;
export type PromptResult =
  | { readonly status: 'received'; readonly message: PromptMessage }
  | { readonly status: 'timeout' }
  | { readonly status: 'cancelled' };

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

export interface PrivateMessageContext extends MessageContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'private';
    }
  >;
}

export type MessageContext = GroupMessageContext | PrivateMessageContext;

export interface ButtonContextBase extends QQEventContext {
  readonly interactionId: string;
  readonly userId: string;
  readonly buttonId: string;
  readonly data: string;
  ack(code?: number): Promise<void>;
  send(message: MessageInput): Promise<SendResult>;
}

export interface GroupButtonContext extends ButtonContextBase {
  readonly scene: 'group';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'group';
    }
  >;
}

export interface PrivateButtonContext extends ButtonContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    MessageTarget,
    {
      scene: 'private';
    }
  >;
}

export type ButtonContext = GroupButtonContext | PrivateButtonContext;

export type CommandReturn = MessageInput | void;

export interface TextMessage {
  readonly kind: 'text';
  readonly content: string;
}

export type ImageSource = string | Uint8Array | UploadedImage;

export interface ImageMessage {
  readonly kind: 'image';
  readonly source: ImageSource;
  readonly caption?: string;
}

export interface MarkdownBody {
  readonly content: string;
  readonly templateId?: never;
  readonly params?: never;
}

export interface MarkdownMessage {
  readonly kind: 'markdown';
  readonly body: MarkdownBody;
  readonly keyboard?: Keyboard;
}

export type OutgoingMessage = TextMessage | ImageMessage | MarkdownMessage;

export type MessageInput = string | OutgoingMessage;

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

export interface ButtonOptions {
  readonly id?: string;
  /** Label after clicking; defaults to the original label. An explicit '' is preserved. */
  readonly visitedLabel?: string;
  readonly style?: 'secondary' | 'primary';
  readonly permission?: ButtonPermission;
}

export interface ButtonBase {
  readonly label: string;
}

export type CallbackButtonOptions = Omit<ButtonOptions, 'id'> & {
  readonly id?: never;
};

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

export interface Keyboard {
  readonly kind: 'inline';
  readonly rows: readonly (readonly KeyboardButton[])[];
  readonly id?: never;
}

export interface UploadedImage {
  readonly kind: 'uploaded-image';
  readonly appId: string;
  readonly apiOrigin: string;
  readonly target: MessageTarget;
  readonly fileInfo: string;
  readonly fileUuid?: string;
  readonly expiresAt?: number;
}

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface ReplyReference {
  messageId: string;
  sequence: number;
}

export interface SendOptions extends RequestOptions {
  reply?: ReplyReference;
}

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

export interface BotUser {
  readonly id: string;
  readonly username?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ApiRequestOptions extends RequestOptions {
  query?: Readonly<Record<string, string | number | boolean | undefined>>;
  body?: unknown;
}

export interface ApiResponse<T> {
  readonly data: T;
  readonly status: number;
  readonly traceId?: string;
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export abstract class QQApi {
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

export abstract class QQClient {
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

export interface QQMarkdownPayload {
  content: string;
  custom_template_id?: never;
  params?: never;
}

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

export interface QQKeyboardPayload {
  id?: never;
  content: QQInlineKeyboardPayload;
}

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

export interface QQFileResult {
  file_info: string;
  file_uuid?: string;
  ttl?: number;
}

export interface Logger {
  debug(message: string, fields?: Readonly<Record<string, unknown>>): void;
  info(message: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(message: string, fields?: Readonly<Record<string, unknown>>): void;
  error(message: string, fields?: Readonly<Record<string, unknown>>): void;
}

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

export interface ErrorContext {
  readonly phase: ErrorPhase;
  readonly appId: string;
  readonly eventName?: string;
  readonly eventId?: string;
  readonly messageId?: string;
  readonly controller?: string;
  readonly method?: string;
}

export type ErrorHandler = (error: Error, context: ErrorContext) => Awaitable<void>;

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
