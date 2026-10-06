import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotFactory, FrameworkError } from '../src/index.js';
import { createAttachmentsProbe } from './attachments-probe.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Configure apps/example/.env before the attachment probe.');
const nonce = randomBytes(3).toString('hex');
const output = resolve('work', 'live-attachments');
mkdirSync(output, { recursive: true });
const logPath = resolve(output, `${nonce}.jsonl`);
const stopPath = resolve(output, `${nonce}.stop`);
function write(entry: object): void {
  const line = JSON.stringify({ at: new Date().toISOString(), ...entry });
  appendFileSync(logPath, line + '\n');
  console.log(line);
}
const probe = createAttachmentsProbe(nonce, write);
let heartbeats = 0;
const app = await BotFactory.create(probe.root, {
  appId,
  secret,
  commands: { invalidInput: 'reply' },
  transport: {
    type: 'ws',
    connectTimeoutMs: 15000,
    closeTimeoutMs: 500,
    retry: { initialAttempts: 1 },
  },
  execution: { shutdownTimeoutMs: 5000 },
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
let finish!: () => void;
const finished = new Promise<void>((resolve) => {
  finish = resolve;
});
process.once('SIGINT', () => finish());
process.once('SIGTERM', () => finish());
let timeout: NodeJS.Timeout | undefined;
let check: NodeJS.Timeout | undefined;
try {
  await app.start();
  write({
    event: 'ready',
    sdk: 'unreleased-source',
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceDirty: !!execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
    commands: probe.commands,
    inputModes: probe.inputModes,
    logPath,
    stopPath,
    timeoutSeconds: 900,
    closesAt: new Date(Date.now() + 900000).toISOString(),
  });
  timeout = setTimeout(finish, 900000);
  check = setInterval(() => {
    if (existsSync(stopPath)) finish();
  }, 1000);
  await finished;
} catch (error) {
  write({ event: 'startup-failed', code: error instanceof FrameworkError ? error.code : 'ERROR' });
  process.exitCode = 1;
} finally {
  clearTimeout(timeout);
  clearInterval(check);
  await app.close();
  restore();
  write({ event: 'closed', heartbeatAcknowledgments: heartbeats });
}
