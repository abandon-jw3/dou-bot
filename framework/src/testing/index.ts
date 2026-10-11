import type {
  BotApplication,
  BotOptions,
  ErrorContext,
  MessageTarget,
  QQDispatch,
  QQMessagePayload,
  Type,
} from '../contracts.js';
import { Application } from '../core/application.js';
import type { FetchPort } from '../qq/http.js';
import { isRecord } from '../core/utils.js';

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
/** Event admission is independent of business success; inspect errors after completion. */
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

export async function createTestApplication(
  root: Type,
  options: TestOptions = {},
): Promise<TestHarness> {
  const messages: RecordedMessage[] = [];
  const acknowledgments: { interactionId: string; code: number }[] = [];
  const errors: { error: Error; context: ErrorContext }[] = [];
  const { respond, ...configuration } = options;
  const fetcher: FetchPort = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const request: TestRequest = {
      method: init?.method ?? 'GET',
      url,
      body,
      headers: new Headers(init?.headers),
    };
    const custom = await respond?.(request);
    if (custom) return custom;
    if (url.pathname === '/app/getAppAccessToken')
      return Response.json({ access_token: 'offline-fixture-access-token', expires_in: 7200 });
    if (url.pathname === '/users/@me')
      return Response.json({ id: 'offline-bot', username: 'Offline bot' });
    const message = /^\/v2\/(groups|users)\/([^/]+)\/messages$/u.exec(url.pathname);
    if (message && request.method === 'POST') {
      const id = decodeURIComponent(message[2] ?? '');
      messages.push({
        target:
          message[1] === 'groups'
            ? { scene: 'group', groupId: id }
            : { scene: 'private', userId: id },
        payload: body as QQMessagePayload,
      });
      return Response.json({
        id: `offline-message-${messages.length}`,
        timestamp: new Date().toISOString(),
      });
    }
    if (/^\/v2\/(groups|users)\/[^/]+\/files$/u.test(url.pathname))
      return Response.json({
        file_info: 'offline-file-info',
        file_uuid: 'offline-file',
        ttl: 3600,
      });
    const interaction = /^\/interactions\/([^/]+)$/u.exec(url.pathname);
    if (interaction && request.method === 'PUT') {
      acknowledgments.push({
        interactionId: decodeURIComponent(interaction[1] ?? ''),
        code: isRecord(body) && typeof body.code === 'number' ? body.code : -1,
      });
      return new Response(null, { status: 204 });
    }
    if (request.method === 'DELETE') return new Response(null, { status: 204 });
    throw new Error(`Unexpected offline request: ${request.method} ${url.pathname}`);
  };
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
