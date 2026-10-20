/** dou-bot/testing public contract, revision 2.0. */
import type {
  BotSnapshot,
  BotStatus,
  QQClient,
  InjectionToken,
  AppOptions,
  Application,
  BotOptions,
  ErrorContext,
  MessageTarget,
  QQDispatch,
  QQMessagePayload,
  Type,
  DiagnosticsReader,
} from './public-api.js';

export interface RecordedMessage {
  target: MessageTarget;
  payload: QQMessagePayload;
}
export interface TestRequest {
  method: string;
  url: URL;
  body: unknown;
  headers: Headers;
}
export interface TestOptions
  extends
    Omit<AppOptions, 'database' | 'bots' | 'outbound' | 'webhook'>,
    Pick<BotOptions, 'api' | 'interactions'> {
  appId?: string;
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
export type TestAdmission =
  | { status: 'accepted' | 'duplicate'; done: Promise<void> }
  | { status: 'ignored' | 'overloaded' | 'stopping' | 'failed' };
export interface TestHarness {
  app: TestApplication;
  messages: readonly RecordedMessage[];
  acknowledgments: readonly { interactionId: string; code: number }[];
  errors: readonly { error: Error; context: ErrorContext }[];
  enqueue(payload: QQDispatch): TestAdmission;
  dispatch(payload: QQDispatch): Promise<TestAdmission['status']>;
  flush(): Promise<void>;
}
export declare function createTestApplication(
  root: Type,
  options?: TestOptions,
): Promise<TestHarness>;

export interface TestApplication {
  readonly diagnostics: DiagnosticsReader;
  readonly status: BotStatus;
  readonly client: QQClient;
  start(): Promise<void>;
  close(): Promise<void>;
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T;
  webhookHandler(): import('node:http').RequestListener;
  snapshot(): BotSnapshot;
}

export interface RecordedBotMessage extends RecordedMessage {
  readonly appId: string;
}
export interface MultiTestOptions extends Omit<AppOptions, 'database' | 'bots' | 'webhook'> {
  bots?: readonly { appId: string; interactions?: { acknowledge?: 'auto' | 'manual' } }[];
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
export interface MultiTestHarness {
  app: Application;
  messages: readonly RecordedBotMessage[];
  acknowledgments: TestHarness['acknowledgments'];
  errors: TestHarness['errors'];
  enqueue(appId: string, payload: QQDispatch): TestAdmission;
  dispatch(appId: string, payload: QQDispatch): Promise<TestAdmission['status']>;
  flush(): Promise<void>;
}

export declare function createMultiTestApplication(
  root: Type,
  options?: MultiTestOptions,
): Promise<MultiTestHarness>;
