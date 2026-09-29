import WebSocket from 'ws';
import { Module, FrameworkError, QQApiError } from '../src/index.js';
import { Application } from '../src/core/application.js';

@Module({})
class Root {}
const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret)
  throw new Error('Configure local QQ credentials before the reconnect probe.');
let socket: WebSocket | undefined;
let connections = 0;
let ready = 0;
let resumed = 0;
let heartbeats = 0;
let disconnected = false;
let finish!: () => void;
const completed = new Promise<void>((resolve) => {
  finish = resolve;
});
const app = await Application.create(
  Root,
  {
    appId,
    secret,
    transport: { type: 'ws', closeTimeoutMs: 500, retry: { initialAttempts: 1 } },
    execution: { shutdownTimeoutMs: 5000 },
    logger: {
      debug(message, fields) {
        if (message === 'QQ event received') {
          if (fields?.type === 'READY') {
            ready++;
            console.log(
              JSON.stringify({ event: 'ready', readyCount: ready, connectionCount: connections }),
            );
            if (disconnected) finish();
          }
          if (fields?.type === 'RESUMED') {
            resumed++;
            console.log(JSON.stringify({ event: 'resumed', connectionCount: connections }));
          }
        }
        if (message === 'QQ heartbeat acknowledged') {
          heartbeats++;
          if (!disconnected) {
            disconnected = true;
            console.log(JSON.stringify({ event: 'disconnecting-owned-socket' }));
            socket?.terminate();
          } else if (resumed) finish();
        }
      },
      info() {},
      warn() {},
      error() {},
    },
    onError(error, context) {
      console.log(
        JSON.stringify({
          event: 'error',
          phase: context.phase,
          code: error instanceof FrameworkError ? error.code : 'ERROR',
          ...(error instanceof QQApiError ? { httpStatus: error.httpStatus } : {}),
        }),
      );
    },
  },
  {
    socketFactory: (url, options) => {
      connections++;
      socket = new WebSocket(url, options);
      return socket;
    },
  },
);
process.once('SIGINT', finish);
process.once('SIGTERM', finish);
let timer: NodeJS.Timeout | undefined;
try {
  await app.start();
  timer = setTimeout(finish, 120000);
  await completed;
} finally {
  clearTimeout(timer);
  await app.close();
  const success = ready === 1 && resumed >= 1 && heartbeats >= 2;
  console.log(
    JSON.stringify({
      event: 'finished',
      success,
      connections,
      ready,
      resumed,
      heartbeats,
      scope:
        'Controlled socket disconnect and authenticated RESUME; no messages sent or replay sequence asserted.',
    }),
  );
  if (!success) process.exitCode = 1;
}
