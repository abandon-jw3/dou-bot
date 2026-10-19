import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';

/** A loopback WS source exercises background dispatch without connecting to a business feed. */
export async function probeFeed(run: (sequence: number) => Promise<void>) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, maxPayload: 1024 });
  let client: WebSocket | undefined;
  let peer: WebSocket | undefined;
  let sequence = 0;
  let closed = false;
  let closing: Promise<void> | undefined;
  let pending:
    | { sequence: number; resolve(): void; reject(error: Error): void; timer: NodeJS.Timeout }
    | undefined;
  const finish = (id: number, error?: Error) => {
    if (pending?.sequence !== id) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    if (error) current.reject(error);
    else current.resolve();
  };
  const fail = () => {
    if (pending) finish(pending.sequence, new Error('Local probe WebSocket closed'));
  };
  server.on('error', fail);
  const close = (): Promise<void> =>
    (closing ??= (async () => {
      closed = true;
      fail();
      client?.terminate();
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    })());
  try {
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected loopback TCP address');
    server.on('connection', (socket) => {
      if (peer) {
        socket.terminate();
        return;
      }
      peer = socket;
      socket.on('error', fail);
      socket.on('close', fail);
    });
    client = new WebSocket(`ws://127.0.0.1:${address.port}`, {
      maxPayload: 1024,
      handshakeTimeout: 5000,
    });
    client.on('error', fail);
    client.on('close', fail);
    client.on('message', (data) => {
      const bytes = Array.isArray(data)
        ? Buffer.concat(data)
        : Buffer.isBuffer(data)
          ? data
          : Buffer.from(data);
      const id = Number(bytes.toString('utf8'));
      if (!Number.isSafeInteger(id) || pending?.sequence !== id) return;
      Promise.resolve()
        .then(() => run(id))
        .then(
          () => finish(id),
          () => finish(id, new Error('Probe dispatch did not complete')),
        );
    });
    await once(client, 'open');
    return {
      send(): Promise<void> {
        if (closed || peer?.readyState !== WebSocket.OPEN || pending)
          return Promise.reject(new Error('Probe feed is closed or busy'));
        const id = ++sequence;
        return new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => finish(id, new Error('Probe dispatch timed out')), 15000);
          pending = { sequence: id, resolve, reject, timer };
          peer!.send(String(id), (error) => {
            if (error) finish(id, error);
          });
        });
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
