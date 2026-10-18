import type {
  AppOptions,
  BotOptions,
  ErrorContext,
  MessageTarget,
  QQDispatch,
  QQMessagePayload,
  Type,
} from '../contracts.js';
import { SingleTestApplication as Application } from './single-bot.js';
import type { TestApplication } from './contracts.js';
export type { TestApplication } from './contracts.js';
import { createFixtures } from './fixtures.js';
export { createMultiTestApplication } from './multi-bot.js';
export type { MultiTestOptions, MultiTestHarness, RecordedBotMessage } from './multi-bot.js';

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
/** Event admission is independent of business success; inspect errors after completion. */
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

export async function createTestApplication(
  root: Type,
  options: TestOptions = {},
): Promise<TestHarness> {
  const { messages, acknowledgments, errors, fetcher } = createFixtures(options);
  const { respond, ...configuration } = options;
  void respond;
  const app = await Application.create(
    root,
    {
      ...configuration,
      appId: options.appId ?? 'offline-app',
      secret: 'offline-fixture-secret-only',
      transport: { type: 'ws' },
      logger: options.logger ?? { debug() {}, info() {}, warn() {}, error() {} },
      onError: (error, context) => {
        errors.push({ error, context });
        return options.onError?.(error, context);
      },
    },
    {
      fetch: fetcher,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    },
  );
  const enqueue = (payload: QQDispatch): TestAdmission => {
    const bytes = JSON.stringify(payload);
    const copy: unknown = JSON.parse(bytes);
    return app.execution.accept(copy, Buffer.byteLength(bytes));
  };
  return {
    app,
    messages,
    acknowledgments,
    errors,
    enqueue,
    dispatch: async (payload) => {
      const admission = enqueue(payload);
      if ('done' in admission) await admission.done;
      return admission.status;
    },
    flush: () => app.execution.idle(),
  };
}
