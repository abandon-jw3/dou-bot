import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import type { RawData } from 'ws';
import type { QQMessagePayload } from '../src/index.js';
import { isRecord } from '../src/core/utils.js';

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export async function until(predicate: () => boolean, timeout = 3000): Promise<void> {
  const end = performance.now() + timeout;
  while (!predicate()) {
    if (performance.now() >= end) throw new Error('Timed out waiting for test state');
    await delay(5);
  }
}
export async function serve(handler: RequestListener) {
  const server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  return {
    server,
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export interface QQServerOptions {
  autoHandshake?: boolean;
  hello?: boolean;
  heartbeatInterval?: number;
  acknowledgeHeartbeats?: boolean;
  onFrame?: (
    socket: WebSocket,
    frame: Record<string, unknown>,
    connection: number,
  ) => void | Promise<void>;
}
export async function qqServer(options: QQServerOptions = {}) {
  const messages: QQMessagePayload[] = [];
  const messagePaths: string[] = [];
  const frames: { connection: number; frame: Record<string, unknown> }[] = [];
  const upgrades: { authorization: string | undefined; appId: string | string[] | undefined }[] =
    [];
  const sockets: WebSocket[] = [];
  const failures: unknown[] = [];
  let gatewayRequests = 0;
  let tokenRequests = 0;
  let url = '';
  const host = await serve((request, response) => {
    const handle = async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of request as AsyncIterable<unknown>)
        if (Buffer.isBuffer(chunk)) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      const body: unknown = raw ? JSON.parse(raw) : undefined;
      const path = request.url ?? '';
      let result: unknown;
      if (path === '/app/getAppAccessToken') {
        tokenRequests++;
        result = { access_token: 'fixture-token', expires_in: '7200' };
      } else if (path === '/gateway') {
        gatewayRequests++;
        result = { url: url.replace('http:', 'ws:') + '/socket' };
      } else if (path === '/users/@me') result = { id: 'fixture-bot' };
      else if (path.endsWith('/messages') && request.method === 'POST') {
        messages.push(body as QQMessagePayload);
        messagePaths.push(path);
        result = { id: `sent-${messages.length}` };
      } else if (path.endsWith('/files')) result = { file_info: 'fixture-file', ttl: 3600 };
      else if (path.startsWith('/interactions/') || request.method === 'DELETE') {
        response.writeHead(204);
        response.end();
        return;
      } else {
        response.statusCode = 404;
        result = { code: 404, message: 'Unknown fixture endpoint' };
      }
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(result));
    };
    handle().catch((error: unknown) => {
      failures.push(error);
      response.writeHead(500);
      response.end();
    });
  });
  url = host.url;
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false });
  host.server.on('upgrade', (request, socket, head) => {
    upgrades.push({
      authorization: request.headers.authorization,
      appId: request.headers['x-union-appid'],
    });
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client));
  });
  wss.on('connection', (socket: WebSocket) => {
    sockets.push(socket);
    const connection = sockets.length;
    socket.on('error', () => {});
    socket.on('message', (data: RawData) => {
      try {
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        const parsed: unknown = JSON.parse(bytes.toString('utf8'));
        if (!isRecord(parsed)) throw new Error('Invalid client frame');
        frames.push({ connection, frame: parsed });
        if (options.autoHandshake !== false) {
          if (parsed.op === 2)
            socket.send(
              JSON.stringify({ op: 0, t: 'READY', s: 1, d: { session_id: 'fixture-session' } }),
            );
          if (parsed.op === 6) socket.send(JSON.stringify({ op: 0, t: 'RESUMED', s: 1, d: {} }));
        }
        if (parsed.op === 1 && options.acknowledgeHeartbeats !== false)
          socket.send(JSON.stringify({ op: 11 }));
        Promise.resolve(options.onFrame?.(socket, parsed, connection)).catch((error: unknown) =>
          failures.push(error),
        );
      } catch (error) {
        failures.push(error);
      }
    });
    if (options.hello !== false)
      socket.send(
        JSON.stringify({ op: 10, d: { heartbeat_interval: options.heartbeatInterval ?? 50 } }),
      );
  });
  return {
    url,
    messages,
    messagePaths,
    frames,
    upgrades,
    sockets,
    failures,
    get gatewayRequests() {
      return gatewayRequests;
    },
    get tokenRequests() {
      return tokenRequests;
    },
    close: async () => {
      for (const socket of wss.clients) socket.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await host.close();
    },
  };
}
