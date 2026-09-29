import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotFactory } from '../src/index.js';
import { createControlsProbe } from './controls-probe.js';
import type { ProbeRecord } from './controls-probe.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Configure local QQ credentials before the controls probe.');
const nonce = randomBytes(4).toString('hex');
const output = resolve('work', 'live-controls');
mkdirSync(output, { recursive: true });
const logPath = resolve(output, `${nonce}.jsonl`);
const stopPath = resolve(output, `${nonce}.stop`);
function write(entry: object): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(logPath, line + '\n');
  console.log(line);
}
const record = (entry: ProbeRecord) => write(entry);
const probe = createControlsProbe(nonce, record);
let finish!: () => void;
const finished = new Promise<void>((resolve) => {
  finish = resolve;
});
let heartbeats = 0;
const app = await BotFactory.create(probe.root, {
  appId,
  secret,
  commands: { prefix: '', invalidInput: 'reply' },
  transport: { type: 'ws', retry: { initialAttempts: 1 }, closeTimeoutMs: 500 },
  execution: { shutdownTimeoutMs: 5000 },
  interactions: { acknowledge: 'manual' },
  logger: {
    debug(message) {
      if (message === 'QQ heartbeat acknowledged') heartbeats++;
    },
    info() {},
    warn() {},
    error() {},
  },
  onError: (error, context) => probe.onError(error, context),
});
const restore = probe.instrument(app);
let timeout: NodeJS.Timeout | undefined;
let check: NodeJS.Timeout | undefined;
process.once('SIGINT', () => finish());
process.once('SIGTERM', () => finish());
try {
  await app.start();
  write({ event: 'ready', commands: probe.commands, timeoutSeconds: 600, logPath, stopPath });
  timeout = setTimeout(finish, 600000);
  check = setInterval(() => {
    if (probe.complete() || existsSync(stopPath)) finish();
  }, 1000);
  await finished;
} finally {
  clearTimeout(timeout);
  clearInterval(check);
  await app.close();
  restore();
  write({
    event: 'finished',
    complete: probe.complete(),
    outcomes: probe.summary(),
    heartbeatAcknowledgments: heartbeats,
  });
}
