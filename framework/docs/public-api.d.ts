/** Public API contract 2.0: shared application, account-scoped targets and PostgreSQL. Unreleased. */
import type { RequestListener } from 'node:http';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export type Awaitable<T> = T | Promise<T>;

/** Opaque, invariant token. Phantom members are not runtime properties; use createContextKey. */
export interface ContextKey<T> {
  readonly __contextKey: never;
  readonly __contextType: (value: T) => T;
}
export interface ContextReader {
  get<T>(key: ContextKey<T>): Promise<T>;
}
export interface ContextWriter extends ContextReader {
  set<T>(key: ContextKey<T>, value: T): void;
  provide<T>(key: ContextKey<T>, loader: (signal: AbortSignal) => Awaitable<T>): void;
}
export interface ContextMiddleware {
  prepare(ctx: MiddlewareContext): Awaitable<void>;
}
export type MiddlewareContext = GuardContext & { readonly state: ContextWriter };
export interface ContextOptions {
  /** Timeout for each prepare invocation. Default 10000 ms. */
  prepareTimeoutMs?: number;
  /** Timeout starting at the first read of each lazy value. Default 10000 ms. */
  loadTimeoutMs?: number;
  /** Maximum registered keys per handler invocation. Default 64. */
  maxEntries?: number;
}

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
  /** Applied to this module's own controllers; imports are independent. */
  middlewares?: readonly InjectionToken<ContextMiddleware>[];
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
  readonly state: ContextReader;
  readonly userId: string;
  readonly controller: Type;
  readonly method: string;
  /** Canonical command name, button ID, or attachment:<controller>.<method>. */
  readonly route: string;
} & (
    | {
        readonly scene: 'group';
        readonly groupId: string;
        /** Present only for group messages with a recognized author role. */
        readonly memberRole?: GroupRole;
        readonly target: Extract<BotTarget, { scene: 'group' }>;
      }
    | { readonly scene: 'private'; readonly target: Extract<BotTarget, { scene: 'private' }> }
  ) &
  (
    | {
        readonly kind: 'command';
        readonly messageId: string;
        readonly content: string;
        readonly attachments: readonly Attachment[];
      }
    | {
        readonly kind: 'attachment';
        readonly messageId: string;
        readonly content: string;
        readonly attachments: readonly Attachment[];
        readonly matchedAttachments: readonly Attachment[];
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

/** Pure synchronous matchers check the original token; choices and match apply together. */
export type SlotOptions = ParameterDescription & {
  default?: string;
  /** Pure synchronous conversion after text checks; defaults are normalized once at bootstrap. */
  normalize?: (text: string) => string;
} & (
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

export interface OnAttachmentOptions {
  filename?: string | RegExp;
  extension?: string;
  kind?: AttachmentKind;
  invalidInput?: 'report' | 'reply';
}

export type AttachmentKind = 'all' | 'image' | 'video' | 'audio' | 'file';
export interface AttachmentSelectionOptions {
  kind?: AttachmentKind;
  minCount?: number;
  maxCount?: number;
}
export type AttachmentSelectionResult =
  | { readonly status: 'valid'; readonly attachments: readonly Attachment[] }
  | {
      readonly status: 'invalid';
      readonly reason: 'too-few' | 'too-many';
      readonly count: number;
      readonly limit: number;
    };

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
  verifyTimeoutMs?: never;
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
  /** Maximum wait for signature verification; defaults to 10 seconds. */
  verifyTimeoutMs?: number;
  /** Includes native verification jobs still running after HTTP timeout/disconnect. */
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

/** Credentials and protocol belong to one account. Business services are application-scoped. */
export interface BotOptions {
  appId: string;
  secret: string;
  transport?:
    | WsTransportOptions
    | (Omit<WebhookTransportOptions, 'listen' | 'host' | 'port'> & {
        listen?: never;
        host?: never;
        port?: never;
      });
  api?: QQApiOptions;
  interactions?: { acknowledge?: 'auto' | 'manual' };
}
export interface DatabaseOptions {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
  ssl?: boolean | { ca: string; rejectUnauthorized?: boolean };
  schema?: string;
  max?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleTimeoutMs?: number;
}
export interface OutboundOptions {
  concurrency?: number;
  queueCapacity?: number;
  queueMaxBytes?: number;
}
export interface AppOptions {
  database: DatabaseOptions;
  bots: readonly BotOptions[];
  commands?: { prefix?: string; invalidInput?: 'report' | 'reply' };
  execution?: ExecutionOptions;
  outbound?: OutboundOptions;
  diagnostics?: DiagnosticsOptions;
  context?: ContextOptions;
  prompts?: PromptConfig;
  webhook?: { listen?: boolean; host?: string; port?: number };
  logger?: Logger;
  onError?: ErrorHandler;
}
export interface OnApplicationReady {
  onApplicationReady(signal: AbortSignal): Awaitable<void>;
}
export interface OnApplicationStopping {
  onApplicationStopping(signal: AbortSignal): Awaitable<void>;
}

export type BotStatus =
  'created' | 'starting' | 'running' | 'reconnecting' | 'stopping' | 'stopped' | 'failed';

export interface BotSnapshot {
  status: BotStatus;
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
  /** Process-local capacity and cache occupancy; not a QQ platform quota. */
  capacity: {
    concurrency: number;
    queueCapacity: number;
    queueMaxBytes: number;
    dedup: { size: number; limit: number };
    replyScopes: { size: number; limit: number };
  };
  /** Each rejected event increments its first applicable reason exactly once. */
  rejections: {
    invalidEvent: number;
    queueFull: number;
    bytesFull: number;
    acknowledgmentsFull: number;
    replyScopesFull: number;
    dedupFull: number;
  };
  /** Lifetime aggregates in milliseconds. No message or user data is retained. */
  timing: {
    /** One sample per initial scheduling or prompt resumption. */
    queueWait: { count: number; totalMs: number; maxMs: number };
    /** One sample per finished started event; excludes queue and suspended prompt time. */
    processing: { count: number; totalMs: number; maxMs: number };
  };
  lastEventAt?: number;
}

export type ApplicationStatus = Exclude<BotStatus, 'reconnecting'> | 'degraded';
export interface QueueSnapshot {
  readonly active: number;
  readonly pending: number;
  readonly retainedBytes: number;
  readonly concurrency: number;
  readonly queueCapacity: number;
  readonly queueMaxBytes: number;
  readonly accepted: number;
  readonly completed: number;
  readonly failed: number;
  readonly rejected: number;
  readonly rejections: Readonly<{ queueFull: number; bytesFull: number; stopping: number }>;
  readonly queueWait: Readonly<{ count: number; totalMs: number; maxMs: number }>;
}
export interface ApplicationSnapshot {
  readonly status: ApplicationStatus;
  readonly bots: readonly (BotSnapshot & { readonly appId: string })[];
  readonly inbound: {
    readonly active: number;
    readonly pending: number;
    readonly retainedBytes: number;
    readonly concurrency: number;
    readonly queueCapacity: number;
    readonly queueMaxBytes: number;
  };
  readonly outbound: QueueSnapshot;
  readonly database: { readonly total: number; readonly idle: number; readonly waiting: number };
}
export interface Application {
  readonly diagnostics: DiagnosticsReader;
  readonly status: ApplicationStatus;
  readonly bots: BotManager;
  start(): Promise<void>;
  close(): Promise<void>;
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T;
  webhookHandler(): RequestListener;
  snapshot(): ApplicationSnapshot;
}
export interface BotHandle {
  readonly appId: string;
  readonly status: BotStatus;
  readonly client: QQClient;
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): BotSnapshot;
}
export abstract class BotManager {
  abstract get(appId: string): BotHandle;
  abstract list(): readonly BotHandle[];
}
export abstract class Database {
  /** Framework-owned; do not call pool.end(). Borrowed clients must be released. */
  abstract readonly pool: Pool;
  abstract readonly schema: string;
  abstract query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
  abstract transaction<T>(run: (client: PoolClient) => Awaitable<T>): Promise<T>;
}
export type BotTarget = MessageTarget & { readonly appId: string };
export type GroupTarget = Extract<BotTarget, { scene: 'group' }>;
export type SendTarget =
  BotTarget | { readonly scene: 'group'; readonly groupId: string; readonly appId?: never };
export abstract class MessageSender {
  abstract sendMessage(
    target: SendTarget,
    message: MessageInput,
    options?: SendOptions,
  ): Promise<SendResult>;
}
/** Addresses are account-scoped OpenIDs. They do not identify a physical group across bots. */
export abstract class GroupRoutes {
  abstract list(groupId: string): Promise<readonly GroupTarget[]>;
  abstract resolve(groupId: string): Promise<GroupTarget>;
  abstract bind(target: GroupTarget): Promise<void>;
  /** Remove the explicit preference, keeping learned addresses. */
  abstract unbind(groupId: string): Promise<void>;
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
  readonly state: ContextReader;
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
    BotTarget,
    {
      scene: 'group';
    }
  >;
}

export interface PrivateMessageContext extends MessageContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    BotTarget,
    {
      scene: 'private';
    }
  >;
}

export type MessageContext = GroupMessageContext | PrivateMessageContext;

export interface ButtonContextBase extends QQEventContext {
  readonly state: ContextReader;
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
    BotTarget,
    {
      scene: 'group';
    }
  >;
}

export interface PrivateButtonContext extends ButtonContextBase {
  readonly scene: 'private';
  readonly target: Extract<
    BotTarget,
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
  | 'database'
  | 'routing'
  | 'middleware'
  | 'context'
  | 'prompt'
  | 'guard'
  | 'cooldown'
  | 'bootstrap'
  | 'transport'
  | 'protocol'
  | 'queue'
  | 'observer'
  | 'command'
  | 'attachment'
  | 'button'
  | 'interaction-ack'
  | 'send'
  | 'shutdown';

export interface ErrorContext {
  readonly phase: ErrorPhase;
  readonly appId?: string;
  readonly sourceAppId?: string;
  readonly eventName?: string;
  readonly eventId?: string;
  readonly messageId?: string;
  readonly controller?: string;
  readonly method?: string;
}

export type ErrorHandler = (error: Error, context: ErrorContext) => Awaitable<void>;

export type FrameworkErrorCode =
  | 'DATABASE'
  | 'DATABASE_SCHEMA'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTE_AMBIGUOUS'
  | 'BOT_UNAVAILABLE'
  | 'CONTEXT_TIMEOUT'
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

export declare function createContextKey<T>(name: string): ContextKey<T>;

export declare function UseMiddleware(
  ...middlewares: readonly InjectionToken<ContextMiddleware>[]
): ClassDecorator & MethodDecorator;

export declare function ContextValue<T>(key: ContextKey<T>): ParameterDecorator;

export declare function Module(metadata: ModuleMetadata): ClassDecorator;

export declare function Injectable(): ClassDecorator;

export declare function Inject(token: InjectionToken): ParameterDecorator;

export declare function Controller(): ClassDecorator;

export declare function UseGuards(
  ...guards: readonly InjectionToken<CanActivate>[]
): ClassDecorator & MethodDecorator;

export declare function Cooldown(options: CooldownOptions): MethodDecorator;

export declare function GroupOnly(options?: AccessOptions): ClassDecorator & MethodDecorator;

export declare function PrivateOnly(options?: AccessOptions): ClassDecorator & MethodDecorator;

export declare function UsersOnly(
  userIds: readonly string[],
  options?: UsersOnlyOptions,
): ClassDecorator & MethodDecorator;

export declare function GroupRoles(
  ...roles: readonly GroupRole[]
): ClassDecorator & MethodDecorator;

export declare function GroupManagersOnly(
  options?: AccessOptions,
): ClassDecorator & MethodDecorator;

export declare function Command(name: string, options?: CommandOptions): MethodDecorator;

export declare function On(eventName: string): MethodDecorator;

export declare function OnButton(buttonId: string): MethodDecorator;

export declare function OnAttachment(options?: OnAttachmentOptions): MethodDecorator;

export declare function Ctx(): ParameterDecorator;

export declare function User(): ParameterDecorator;

export declare function UserId(): ParameterDecorator;

export declare function Group(): ParameterDecorator;

export declare function GroupId(): ParameterDecorator;

export declare function Role(): ParameterDecorator;

export declare function selectAttachments(
  attachments: readonly Attachment[],
  options?: AttachmentSelectionOptions,
): AttachmentSelectionResult;

export declare function Arg(index: number, options?: ArgumentOptions): ParameterDecorator;

export declare function Args(): ParameterDecorator;

export declare function Option(name: string, options?: OptionOptions): ParameterDecorator;

export declare function Slot(name: string, options: SlotOptions): ParameterDecorator;

export declare function Rest(options?: RestOptions): ParameterDecorator;

export declare function Attachments(options?: AttachmentOptions): ParameterDecorator;

export declare function Images(options?: AttachmentOptions): ParameterDecorator;

export declare class HelpModule {}

export declare function text(content: string): TextMessage;

export declare function image(source: ImageSource, options?: { caption?: string }): ImageMessage;

export declare function markdown(
  content: string,
  options?: { keyboard?: Keyboard },
): MarkdownMessage;

export declare function keyboard(rows: readonly (readonly KeyboardButton[])[]): Keyboard;

export declare const button: {
  link(label: string, url: string, options?: ButtonOptions): KeyboardButton;
  command(
    label: string,
    command: string,
    options?: ButtonOptions & { enter?: boolean },
  ): KeyboardButton;
  callback(
    id: string,
    label: string,
    data?: string,
    options?: CallbackButtonOptions,
  ): KeyboardButton;
};

export declare const LOGGER: unique symbol;

export declare class FrameworkError extends Error {
  readonly code: FrameworkErrorCode;
  constructor(code: FrameworkErrorCode, message: string, options?: ErrorOptions);
}

export declare class QQApiError extends FrameworkError {
  readonly name: 'QQApiError';
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
export declare const AppFactory: { create(root: Type, options: AppOptions): Promise<Application> };
export declare function migrateDatabase(options: DatabaseOptions): Promise<void>;

/** Stable framework boundaries. Durations are wall time, not CPU time. */
export type DiagnosticsStage =
  | 'webhook.request'
  | 'webhook.body'
  | 'webhook.parse'
  | 'webhook.verify'
  | 'webhook.verify.wait'
  | 'ws.parse'
  | 'event.admission'
  | 'event.normalize'
  | 'event.queue'
  | 'event.run'
  | 'event.total'
  | 'event.drain'
  | 'handler.total'
  | 'handler.middleware'
  | 'handler.guard'
  | 'handler.bind'
  | 'handler.context'
  | 'handler.cooldown'
  | 'handler.invoke'
  | 'handler.observer'
  | 'context.load'
  | 'context.lookup'
  | 'reply.wait'
  | 'message.prepare'
  | 'outbound.queue'
  | 'outbound.run'
  | 'control.queue'
  | 'control.run'
  | 'qq.token.wait'
  | 'qq.token.refresh'
  | 'qq.http'
  | 'qq.http.headers'
  | 'qq.http.body'
  | 'route.learn'
  | 'route.lookup'
  | 'prompt.wait'
  | 'cache.prune';

export type DiagnosticsOutcome =
  | 'success'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'rejected'
  | 'ignored'
  | 'duplicate'
  | 'cache-hit';

export type DiagnosticsOperation =
  'message' | 'upload' | 'interaction' | 'token' | 'gateway' | 'other';

export interface DiagnosticsOptions {
  /** Defaults to false. Existing application snapshots remain available when disabled. */
  enabled?: boolean;
  /** Probability of sampling an entire incoming event or background operation; default 0. */
  traceSampleRate?: number;
  /** Maximum distinct stage/account/handler/component combinations; default 2048. */
  maxSeries?: number;
  /** Maximum simultaneously tracked stage intervals; default 4096. */
  maxActiveSpans?: number;
  /** Maximum buffered plus currently exported sampled spans; default 2048. */
  maxPendingSpans?: number;
  /** Optional asynchronous batch consumer. Failures disable automatic export and are counted. */
  onSpans?: (spans: readonly DiagnosticsSpan[], signal: AbortSignal) => Awaitable<void>;
  /** Batch export interval; default 1000 ms. No periodic work without onSpans. */
  exportIntervalMs?: number;
  /** Maximum wait for a batch consumer; default 1000 ms. */
  exportTimeoutMs?: number;
}

export interface DiagnosticsMetric {
  readonly stage: DiagnosticsStage;
  readonly appId?: string;
  /** Registered controller/method, never command input or a user identifier. */
  readonly handler?: string;
  /** Zero-based middleware/guard position in this handler's resolved declaration order. */
  readonly component?: number;
  /** Fixed QQ API family; URLs and identifiers are never retained. */
  readonly operation?: DiagnosticsOperation;
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly active: number;
  readonly oldestActiveMs: number;
  readonly outcomes: Readonly<Record<DiagnosticsOutcome, number>>;
  /** Noncumulative bins. Last bin is overflow beyond the snapshot's finite upper bounds. */
  readonly buckets: readonly number[];
  /** Approximate upper bounds; null for no samples or a quantile in the overflow bin. */
  readonly p50UpperMs: number | null;
  readonly p95UpperMs: number | null;
  readonly p99UpperMs: number | null;
}

export interface DiagnosticsSpan {
  /** Opaque local correlation identifiers, unrelated to QQ event/user/group identifiers. */
  readonly traceId: string;
  readonly spanId: number;
  readonly parentSpanId?: number;
  readonly stage: DiagnosticsStage;
  readonly appId?: string;
  readonly handler?: string;
  readonly component?: number;
  readonly operation?: DiagnosticsOperation;
  readonly startedMs: number;
  readonly durationMs: number;
  readonly outcome: DiagnosticsOutcome;
}

export interface DiagnosticsSnapshot {
  readonly enabled: boolean;
  readonly closed: boolean;
  readonly elapsedMs: number;
  readonly bucketUpperBoundsMs: readonly number[];
  readonly metrics: readonly DiagnosticsMetric[];
  readonly activeSpans: number;
  readonly bufferedSpans: number;
  readonly exportingSpans: number;
  readonly droppedMeasurements: number;
  readonly droppedSpans: number;
  readonly exportFailures: number;
  readonly exportDisabled: boolean;
}

export interface DiagnosticsReader {
  /** Cumulative metrics since application construction; does not reset counters. */
  snapshot(): DiagnosticsSnapshot;
  /** Consume queued sampled records. Records already in an export batch are excluded. */
  takeSpans(): readonly DiagnosticsSpan[];
}
