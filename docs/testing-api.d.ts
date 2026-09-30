/** dou-bot/testing public contract for the 1.0 review; additive to the 0.6.0 API. */
import type {
  BotApplication,
  BotOptions,
  ErrorContext,
  MessageTarget,
  QQDispatch,
  QQMessagePayload,
  Type,
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
export interface TestOptions extends Omit<BotOptions, 'appId' | 'secret' | 'transport'> {
  appId?: string;
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
export type TestAdmission =
  | { status: 'accepted' | 'duplicate'; done: Promise<void> }
  | { status: 'ignored' | 'overloaded' | 'stopping' | 'failed' };
export interface TestHarness {
  app: BotApplication;
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
