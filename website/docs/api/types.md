# 类型与接口

查询各个 API 的参数、返回值与类型。

- 业务 API 从 `dou-bot` 导入。
- 离线测试从 `dou-bot/testing` 导入。
- 用法见 [装饰器参考](./decorators.md) 和 [完整示例](../examples/hello.md)。

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

### AppFactory {#root-AppFactory}

```ts
export declare const AppFactory: {
  create: (root: Type, options: AppOptions) => Promise<Application>;
};
```

### Application {#root-Application}

```ts
export interface Application {
  readonly diagnostics: DiagnosticsReader;
  readonly status: ApplicationStatus;
  readonly bots: BotManager;
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

### ApplicationSnapshot {#root-ApplicationSnapshot}

```ts
export interface ApplicationSnapshot {
  readonly status: ApplicationStatus;
  readonly bots: readonly (BotSnapshot & {
    readonly appId: string;
  })[];
  readonly inbound: {
    readonly active: number;
    readonly pending: number;
    readonly retainedBytes: number;
    readonly concurrency: number;
    readonly queueCapacity: number;
    readonly queueMaxBytes: number;
  };
  readonly outbound: QueueSnapshot;
  readonly database: {
    readonly total: number;
    readonly idle: number;
    readonly waiting: number;
  };
}
```

### ApplicationStatus {#root-ApplicationStatus}

```ts
export type ApplicationStatus = Exclude<BotStatus, 'reconnecting'> | 'degraded';
```

### AppOptions {#root-AppOptions}

```ts
export interface AppOptions {
  database: DatabaseOptions;
  bots: readonly BotOptions[];
  commands?: {
    prefix?: string;
    invalidInput?: 'report' | 'reply';
  };
  execution?: ExecutionOptions;
  outbound?: OutboundOptions;
  diagnostics?: DiagnosticsOptions;
  context?: ContextOptions;
  prompts?: PromptConfig;
  webhook?: {
    listen?: boolean;
    host?: string;
    port?: number;
  };
  logger?: Logger;
  onError?: ErrorHandler;
}
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
  readonly voiceWavUrl?: string;
  readonly asrReferText?: string;
  readonly raw: Readonly<Record<string, unknown>>;
}
```

### AttachmentKind {#root-AttachmentKind}

```ts
export type AttachmentKind = 'all' | 'image' | 'video' | 'audio' | 'file';
```

### AttachmentOptions {#root-AttachmentOptions}

```ts
export interface AttachmentOptions {
  name?: string;
  description?: string;
  minCount?: number;
  maxCount?: number;
}
```

### Attachments {#root-Attachments}

```ts
export declare const Attachments: (options?: AttachmentOptions) => ParameterDecorator;
```

### AttachmentSelectionOptions {#root-AttachmentSelectionOptions}

```ts
export interface AttachmentSelectionOptions {
  kind?: AttachmentKind;
  minCount?: number;
  maxCount?: number;
}
```

### AttachmentSelectionResult {#root-AttachmentSelectionResult}

```ts
export type AttachmentSelectionResult =
  | {
      readonly status: 'valid';
      readonly attachments: readonly Attachment[];
    }
  | {
      readonly status: 'invalid';
      readonly reason: 'too-few' | 'too-many';
      readonly count: number;
      readonly limit: number;
    };
```

### Awaitable {#root-Awaitable}

```ts
export type Awaitable<T> = T | Promise<T>;
```

### BotHandle {#root-BotHandle}

```ts
export interface BotHandle {
  readonly appId: string;
  readonly status: BotStatus;
  readonly client: QQClient;
  start(): Promise<void>;
  stop(): Promise<void>;
  snapshot(): BotSnapshot;
}
```

### BotManager {#root-BotManager}

```ts
export declare abstract class BotManager {
  abstract get(appId: string): BotHandle;
  abstract list(): readonly BotHandle[];
}
```

### BotOptions {#root-BotOptions}

```ts
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
  interactions?: {
    acknowledge?: 'auto' | 'manual';
  };
}
```

### BotSnapshot {#root-BotSnapshot}

```ts
export interface BotSnapshot {
  status: BotStatus;
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
  /** Process-local capacity and cache occupancy; not a QQ platform quota. */
  capacity: {
    concurrency: number;
    queueCapacity: number;
    queueMaxBytes: number;
    dedup: {
      size: number;
      limit: number;
    };
    replyScopes: {
      size: number;
      limit: number;
    };
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
    queueWait: {
      count: number;
      totalMs: number;
      maxMs: number;
    };
    /** One sample per finished started event; excludes queue and suspended prompt time. */
    processing: {
      count: number;
      totalMs: number;
      maxMs: number;
    };
  };
  lastEventAt?: number;
}
```

### BotStatus {#root-BotStatus}

```ts
export type BotStatus =
  'created' | 'starting' | 'running' | 'reconnecting' | 'stopping' | 'stopped' | 'failed';
```

### BotTarget {#root-BotTarget}

```ts
export type BotTarget = MessageTarget & {
  readonly appId: string;
};
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
  readonly state: ContextReader;
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

### ContextKey {#root-ContextKey}

```ts
export interface ContextKey<T> {
  readonly __contextKey: never;
  readonly __contextType: (value: T) => T;
}
```

### ContextMiddleware {#root-ContextMiddleware}

```ts
export interface ContextMiddleware {
  prepare(ctx: MiddlewareContext): Awaitable<void>;
}
```

### ContextOptions {#root-ContextOptions}

```ts
export interface ContextOptions {
  /** Timeout for each prepare invocation. Default 10000 ms. */
  prepareTimeoutMs?: number;
  /** Timeout starting at the first read of each lazy value. Default 10000 ms. */
  loadTimeoutMs?: number;
  /** Maximum registered keys per handler invocation. Default 64. */
  maxEntries?: number;
}
```

### ContextReader {#root-ContextReader}

```ts
export interface ContextReader {
  get<T>(key: ContextKey<T>): Promise<T>;
}
```

### ContextValue {#root-ContextValue}

```ts
export declare function ContextValue<T>(key: ContextKey<T>): ParameterDecorator;
```

### ContextWriter {#root-ContextWriter}

```ts
export interface ContextWriter extends ContextReader {
  set<T>(key: ContextKey<T>, value: T): void;
  provide<T>(key: ContextKey<T>, loader: (signal: AbortSignal) => Awaitable<T>): void;
}
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

### createContextKey {#root-createContextKey}

```ts
export declare function createContextKey<T>(name: string): ContextKey<T>;
```

### Ctx {#root-Ctx}

```ts
export declare const Ctx: () => ParameterDecorator;
```

### Database {#root-Database}

```ts
export declare abstract class Database {
  /** Framework-owned; do not call pool.end(). Borrowed clients must be released. */
  abstract readonly pool: Pool;
  abstract readonly schema: string;
  abstract query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>>;
  abstract transaction<T>(run: (client: PoolClient) => Awaitable<T>): Promise<T>;
}
```

### DatabaseOptions {#root-DatabaseOptions}

```ts
export interface DatabaseOptions {
  host: string;
  user: string;
  password: string;
  database: string;
  port?: number;
  ssl?:
    | boolean
    | {
        ca: string;
        rejectUnauthorized?: boolean;
      };
  schema?: string;
  max?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
  idleTimeoutMs?: number;
}
```

### DiagnosticsMetric {#root-DiagnosticsMetric}

```ts
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
```

### DiagnosticsOperation {#root-DiagnosticsOperation}

```ts
export type DiagnosticsOperation =
  'message' | 'upload' | 'interaction' | 'token' | 'gateway' | 'other';
```

### DiagnosticsOptions {#root-DiagnosticsOptions}

```ts
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
```

### DiagnosticsOutcome {#root-DiagnosticsOutcome}

```ts
export type DiagnosticsOutcome =
  | 'success'
  | 'error'
  | 'timeout'
  | 'cancelled'
  | 'rejected'
  | 'ignored'
  | 'duplicate'
  | 'cache-hit';
```

### DiagnosticsReader {#root-DiagnosticsReader}

```ts
export interface DiagnosticsReader {
  /** Cumulative metrics since application construction; does not reset counters. */
  snapshot(): DiagnosticsSnapshot;
  /** Consume queued sampled records. Records already in an export batch are excluded. */
  takeSpans(): readonly DiagnosticsSpan[];
}
```

### DiagnosticsSnapshot {#root-DiagnosticsSnapshot}

```ts
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
```

### DiagnosticsSpan {#root-DiagnosticsSpan}

```ts
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
```

### DiagnosticsStage {#root-DiagnosticsStage}

```ts
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
```

### ErrorContext {#root-ErrorContext}

```ts
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
```

### ErrorHandler {#root-ErrorHandler}

```ts
export type ErrorHandler = (error: Error, context: ErrorContext) => Awaitable<void>;
```

### ErrorPhase {#root-ErrorPhase}

```ts
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
```

### Group {#root-Group}

```ts
export declare const Group: () => ParameterDecorator;
```

### GroupButtonContext {#root-GroupButtonContext}

```ts
export interface GroupButtonContext extends ButtonContextBase {
  readonly scene: 'group';
  readonly target: Extract<
    BotTarget,
    {
      scene: 'group';
    }
  >;
}
```

### GroupId {#root-GroupId}

```ts
export declare const GroupId: () => ParameterDecorator;
```

### GroupInfo {#root-GroupInfo}

```ts
export interface GroupInfo {
  readonly id: string;
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
    BotTarget,
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

### GroupRoutes {#root-GroupRoutes}

```ts
export declare abstract class GroupRoutes {
  abstract list(groupId: string): Promise<readonly GroupTarget[]>;
  abstract resolve(groupId: string): Promise<GroupTarget>;
  abstract bind(target: GroupTarget): Promise<void>;
  /** Remove the explicit preference, keeping learned addresses. */
  abstract unbind(groupId: string): Promise<void>;
}
```

### GroupTarget {#root-GroupTarget}

```ts
export type GroupTarget = Extract<
  BotTarget,
  {
    scene: 'group';
  }
>;
```

### GuardContext {#root-GuardContext}

```ts
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
        readonly target: Extract<
          BotTarget,
          {
            scene: 'group';
          }
        >;
      }
    | {
        readonly scene: 'private';
        readonly target: Extract<
          BotTarget,
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

### Images {#root-Images}

```ts
export declare const Images: (options?: AttachmentOptions) => ParameterDecorator;
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
```

### MessageInput {#root-MessageInput}

```ts
export type MessageInput = string | OutgoingMessage;
```

### MessageSender {#root-MessageSender}

```ts
export declare abstract class MessageSender {
  abstract sendMessage(
    target: SendTarget,
    message: MessageInput,
    options?: SendOptions,
  ): Promise<SendResult>;
}
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

### MiddlewareContext {#root-MiddlewareContext}

```ts
export type MiddlewareContext = GuardContext & {
  readonly state: ContextWriter;
};
```

### migrateDatabase {#root-migrateDatabase}

```ts
export declare function migrateDatabase(options: DatabaseOptions): Promise<void>;
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
  /** Applied to this module's own controllers; imports are independent. */
  middlewares?: readonly InjectionToken<ContextMiddleware>[];
}
```

### On {#root-On}

```ts
export declare const On: (eventName: string) => MethodDecorator;
```

### OnApplicationReady {#root-OnApplicationReady}

```ts
export interface OnApplicationReady {
  onApplicationReady(signal: AbortSignal): Awaitable<void>;
}
```

### OnApplicationStopping {#root-OnApplicationStopping}

```ts
export interface OnApplicationStopping {
  onApplicationStopping(signal: AbortSignal): Awaitable<void>;
}
```

### OnAttachment {#root-OnAttachment}

```ts
export declare function OnAttachment(options?: OnAttachmentOptions): MethodDecorator;
```

### OnAttachmentOptions {#root-OnAttachmentOptions}

```ts
export interface OnAttachmentOptions {
  filename?: string | RegExp;
  extension?: string;
  kind?: AttachmentKind;
  invalidInput?: 'report' | 'reply';
}
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

### OutboundOptions {#root-OutboundOptions}

```ts
export interface OutboundOptions {
  concurrency?: number;
  queueCapacity?: number;
  queueMaxBytes?: number;
}
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
    BotTarget,
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
    BotTarget,
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

### QueueSnapshot {#root-QueueSnapshot}

```ts
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
  readonly rejections: Readonly<{
    queueFull: number;
    bytesFull: number;
    stopping: number;
  }>;
  readonly queueWait: Readonly<{
    count: number;
    totalMs: number;
    maxMs: number;
  }>;
}
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

### Role {#root-Role}

```ts
export declare const Role: () => ParameterDecorator;
```

### selectAttachments {#root-selectAttachments}

```ts
export declare function selectAttachments(
  attachments: readonly Attachment[],
  options?: AttachmentSelectionOptions,
): AttachmentSelectionResult;
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

### SendTarget {#root-SendTarget}

```ts
export type SendTarget =
  | BotTarget
  | {
      readonly scene: 'group';
      readonly groupId: string;
      readonly appId?: never;
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
  /** Pure synchronous conversion after text checks; defaults are normalized once at bootstrap. */
  normalize?: (text: string) => string;
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

### UseMiddleware {#root-UseMiddleware}

```ts
export declare function UseMiddleware(
  ...middlewares: readonly InjectionToken<ContextMiddleware>[]
): ClassDecorator & MethodDecorator;
```

### User {#root-User}

```ts
export declare const User: () => ParameterDecorator;
```

### UserId {#root-UserId}

```ts
export declare const UserId: () => ParameterDecorator;
```

### UserInfo {#root-UserInfo}

```ts
export interface UserInfo {
  readonly id: string;
  readonly username?: string;
  readonly bot?: boolean;
  readonly memberRole?: GroupRole;
}
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
  verifyTimeoutMs?: never;
  maxConcurrentRequests?: never;
  maxSignatureAgeMs?: never;
}
```

## dou-bot/testing

在本地运行模块、投递模拟事件并检查处理结果的测试工具与类型。

### createMultiTestApplication {#testing-createMultiTestApplication}

```ts
export declare function createMultiTestApplication(
  root: Type,
  options?: MultiTestOptions,
): Promise<MultiTestHarness>;
```

### createTestApplication {#testing-createTestApplication}

```ts
export declare function createTestApplication(
  root: Type,
  options?: TestOptions,
): Promise<TestHarness>;
```

### MultiTestHarness {#testing-MultiTestHarness}

```ts
export interface MultiTestHarness {
  app: ApplicationContract;
  messages: readonly RecordedBotMessage[];
  acknowledgments: TestHarness['acknowledgments'];
  errors: TestHarness['errors'];
  enqueue(appId: string, payload: QQDispatch): TestAdmission;
  dispatch(appId: string, payload: QQDispatch): Promise<TestAdmission['status']>;
  flush(): Promise<void>;
}
```

### MultiTestOptions {#testing-MultiTestOptions}

```ts
export interface MultiTestOptions extends Omit<AppOptions, 'database' | 'bots' | 'webhook'> {
  bots?: readonly {
    appId: string;
    interactions?: {
      acknowledge?: 'auto' | 'manual';
    };
  }[];
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
```

### RecordedBotMessage {#testing-RecordedBotMessage}

```ts
export interface RecordedBotMessage extends RecordedMessage {
  readonly appId: string;
}
```

### RecordedMessage {#testing-RecordedMessage}

```ts
export interface RecordedMessage {
  target: MessageTarget;
  payload: QQMessagePayload;
}
```

### TestAdmission {#testing-TestAdmission}

```ts
export type TestAdmission =
  | {
      status: 'accepted' | 'duplicate';
      done: Promise<void>;
    }
  | {
      status: 'ignored' | 'overloaded' | 'stopping' | 'failed';
    };
```

### TestApplication {#testing-TestApplication}

```ts
export interface TestApplication {
  readonly diagnostics: DiagnosticsReader;
  readonly status: BotStatus;
  readonly client: import('../contracts.js').QQClient;
  start(): Promise<void>;
  close(): Promise<void>;
  get<T>(
    token: InjectionToken<T>,
    options?: {
      module?: Type;
    },
  ): T;
  webhookHandler(): RequestListener;
  snapshot(): BotSnapshot;
}
```

### TestHarness {#testing-TestHarness}

提供 app、messages、acknowledgments、errors、enqueue、dispatch 和 flush。接纳结果为结构化返回值，详情见 [测试入口 API](./testing.md#testharness)。

### TestOptions {#testing-TestOptions}

```ts
export interface TestOptions
  extends
    Omit<AppOptions, 'database' | 'bots' | 'outbound' | 'webhook'>,
    Pick<BotOptions, 'api' | 'interactions'> {
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
