import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import type { QQDispatch } from '../../src/index.js';
import { record } from './common.js';

const maxBufferedBytes = 4 * 1024 * 1024;
interface Account {
  socket?: WebSocket;
  ready: boolean;
  sequence: number;
  heartbeatSequence: number;
  session: string;
  connections: number;
  identifies: number;
  resumes: number;
  heartbeats: number;
  disconnects: number;
  lastResumeSequence?: number;
  maximumBufferedBytes: number;
}

/** Real WS peer, hosted beside the generator, outside the measured server budget.
 * No automatic replay: reconnect observations never imply a QQ delivery guarantee.
 */
export async function startGateway(ids: readonly string[]) {
  const accounts = new Map<string, Account>(
    ids.map((id) => [
      id,
      {
        ready: false,
        sequence: 0,
        heartbeatSequence: 0,
        session: `fixture-session-${id}`,
        connections: 0,
        identifies: 0,
        resumes: 0,
        heartbeats: 0,
        disconnects: 0,
        maximumBufferedBytes: 0,
      },
    ]),
  );
  const http = createServer((_request, response) => {
    response.writeHead(404).end();
  });
  const server = new WebSocketServer({ server: http, maxPayload: 16384, perMessageDeflate: false });
  const errors: string[] = [];
  let errorCount = 0;
  let closing = false;
  const fail = (error: unknown) => {
    errorCount++;
    if (errors.length < 20) errors.push(String(error));
  };
  const send = (socket: WebSocket, payload: unknown) =>
    socket.send(JSON.stringify(payload), (error) => {
      if (error && !closing) fail(error);
    });
  server.on('connection', (socket, request) => {
    const account = accounts.get(String(request.headers['x-union-appid']));
    if (!account || account.socket?.readyState === WebSocket.OPEN) {
      fail('Unknown account or simultaneous sockets for one account');
      socket.close(4004);
      return;
    }
    account.socket = socket;
    account.ready = false;
    account.connections++;
    send(socket, { op: 10, d: { heartbeat_interval: 1000 } });
    socket.on('message', (bytes) => {
      try {
        const buffer = Array.isArray(bytes)
          ? Buffer.concat(bytes)
          : Buffer.isBuffer(bytes)
            ? bytes
            : Buffer.from(bytes);
        const frame: unknown = JSON.parse(buffer.toString('utf8'));
        assert.ok(record(frame));
        if (frame.op === 2 || frame.op === 6) {
          assert.ok(!account.ready && record(frame.d));
          assert.ok(
            typeof frame.d.token === 'string' && frame.d.token.startsWith('QQBot fixture-token-'),
          );
          if (frame.op === 2) {
            account.identifies++;
            account.sequence = 1;
            account.heartbeatSequence = 1;
            send(socket, { op: 0, t: 'READY', s: 1, d: { session_id: account.session } });
          } else {
            assert.equal(frame.d.session_id, account.session);
            assert.ok(
              typeof frame.d.seq === 'number' &&
                Number.isSafeInteger(frame.d.seq) &&
                frame.d.seq >= 1 &&
                frame.d.seq <= account.sequence,
            );
            account.resumes++;
            account.lastResumeSequence = frame.d.seq;
            // RESUMED carries the current stream sequence, but does not replay older frames.
            send(socket, { op: 0, t: 'RESUMED', s: account.sequence, d: {} });
          }
          account.ready = true;
        } else if (frame.op === 1) {
          const seq = frame.s ?? frame.d;
          assert.ok(typeof seq === 'number' && seq >= 0 && seq <= account.sequence);
          account.heartbeatSequence = seq;
          account.heartbeats++;
          send(socket, { op: 11 });
        } else assert.fail('Unexpected gateway client opcode');
      } catch (error) {
        fail(error);
        socket.close(4004);
      }
    });
    socket.once('error', (error) => {
      if (!closing) fail(error);
    });
    socket.once('close', () => {
      account.disconnects++;
      if (account.socket === socket) {
        account.ready = false;
        delete account.socket;
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(0, '127.0.0.1', resolve);
  });
  const address = http.address();
  assert.ok(address && typeof address !== 'string');
  const snapshot = () => ({
    replayPolicy: 'none',
    maxBufferedBytes,
    errorCount,
    errors: [...errors],
    accounts: Object.fromEntries(
      [...accounts].map(([id, account]) => {
        const { socket, ...state } = account;
        return [id, { ...state, bufferedBytes: socket?.bufferedAmount ?? 0 }];
      }),
    ),
    connections: server.clients.size,
  });
  let closeTask: Promise<void> | undefined;
  return {
    origin: `ws://127.0.0.1:${address.port}`,
    snapshot,
    /** Callback success only means a socket write, never an admission acknowledgment. */
    write(id: string, payload: QQDispatch, done: (error?: Error) => void) {
      const account = accounts.get(id);
      assert.ok(account);
      const socket = account.socket;
      if (!account.ready || !socket || socket.readyState !== WebSocket.OPEN) return 'unavailable';
      const body = JSON.stringify({ ...payload, s: account.sequence + 1 });
      if (socket.bufferedAmount + Buffer.byteLength(body) > maxBufferedBytes) return 'backpressure';
      account.sequence++;
      socket.send(body, (error) => done(error ?? undefined));
      account.maximumBufferedBytes = Math.max(account.maximumBufferedBytes, socket.bufferedAmount);
      return 'writing';
    },
    reconnect(id: string) {
      const account = accounts.get(id);
      assert.ok(account?.ready && account.socket);
      send(account.socket, { op: 7 });
      account.ready = false;
    },
    // A heartbeat response is ordered after previously sent frames. It only proves parsing,
    // not completion; closed connections are accounted separately as possible delivery loss.
    drained() {
      return [...accounts.values()].every(
        (account) =>
          !account.ready ||
          (account.heartbeatSequence >= account.sequence &&
            (account.socket?.bufferedAmount ?? 0) === 0),
      );
    },
    close() {
      closeTask ??= (async () => {
        closing = true;
        for (const socket of server.clients) socket.terminate();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await new Promise<void>((resolve) => http.close(() => resolve()));
      })();
      return closeTask;
    },
  };
}
