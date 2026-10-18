import type { ErrorContext, QQMessagePayload } from '../contracts.js';
import type { RecordedMessage, TestOptions, TestRequest } from './index.js';
import type { FetchPort } from '../qq/http.js';
import { isRecord } from '../core/utils.js';
export function createFixtures(options: Pick<TestOptions, 'respond'>) {
  const messages: RecordedMessage[] = [];
  const botMessages: (RecordedMessage & { appId: string })[] = [];
  const acknowledgments: { interactionId: string; code: number }[] = [];
  const errors: { error: Error; context: ErrorContext }[] = [];
  const { respond } = options;
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
      botMessages.push({
        ...messages[messages.length - 1]!,
        appId: request.headers.get('X-Union-Appid') ?? '',
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

  return { messages, botMessages, acknowledgments, errors, fetcher };
}
