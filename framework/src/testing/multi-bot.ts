import type {
  AppOptions,
  Application as ApplicationContract,
  QQDispatch,
  Type,
} from '../contracts.js';
import { Application } from '../core/application.js';
import { MemoryPersistence } from './memory-persistence.js';
import { createFixtures } from './fixtures.js';
import type { RecordedMessage, TestAdmission, TestHarness, TestRequest } from './index.js';
export interface RecordedBotMessage extends RecordedMessage {
  readonly appId: string;
}
export interface MultiTestOptions extends Omit<AppOptions, 'database' | 'bots' | 'webhook'> {
  bots?: readonly { appId: string; interactions?: { acknowledge?: 'auto' | 'manual' } }[];
  respond?: (request: TestRequest) => Response | Promise<Response> | undefined;
}
export interface MultiTestHarness {
  app: ApplicationContract;
  messages: readonly RecordedBotMessage[];
  acknowledgments: TestHarness['acknowledgments'];
  errors: TestHarness['errors'];
  enqueue(appId: string, payload: QQDispatch): TestAdmission;
  dispatch(appId: string, payload: QQDispatch): Promise<TestAdmission['status']>;
  flush(): Promise<void>;
}
export async function createMultiTestApplication(
  root: Type,
  options: MultiTestOptions = {},
): Promise<MultiTestHarness> {
  const fixture = createFixtures(options);
  const { bots, respond, ...shared } = options;
  void respond;
  const app = await Application.create(
    root,
    {
      ...shared,
      database: { host: '127.0.0.1', user: 'offline', database: 'offline', password: '' },
      bots: (bots ?? [{ appId: 'offline-app' }]).map((bot) => ({
        ...bot,
        secret: 'offline-fixture-secret-only',
      })),
      logger: options.logger ?? { debug() {}, info() {}, warn() {}, error() {} },
      onError: (error, context) => {
        fixture.errors.push({ error, context });
        return options.onError?.(error, context);
      },
    },
    {
      persistence: new MemoryPersistence(),
      fetch: fixture.fetcher,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    },
  );
  const enqueue = (appId: string, payload: QQDispatch): TestAdmission => {
    const bytes = JSON.stringify(payload);
    return app
      .runtime(appId)
      .execution.accept(JSON.parse(bytes) as unknown, Buffer.byteLength(bytes));
  };
  return {
    app,
    messages: fixture.botMessages,
    acknowledgments: fixture.acknowledgments,
    errors: fixture.errors,
    enqueue,
    dispatch: async (appId, payload) => {
      const admission = enqueue(appId, payload);
      if ('done' in admission) await admission.done;
      return admission.status;
    },
    flush: async () => {
      await Promise.all(app.bots.list().map((bot) => app.runtime(bot.appId).execution.idle()));
    },
  };
}
