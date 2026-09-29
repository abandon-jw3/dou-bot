import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { BotFactory, FrameworkError, QQApiError } from 'dd-bot';
import { createModule } from './app.js';
import { readConfig } from './config.js';
import type { AuditEvent } from './config.js';

async function live(): Promise<void> {
  const appId = process.env.QQ_APP_ID;
  const secret = process.env.QQ_APP_SECRET;
  if (!appId || !secret) throw new Error('Configure QQ credentials locally before the live test');
  const nonce = randomBytes(4).toString('hex');
  const config = { ...readConfig({}), prefix: `试用-${nonce}:`, liveEnrollment: true };
  const output = resolve('work', 'live');
  mkdirSync(output, { recursive: true });
  const logPath = resolve(output, `${nonce}.jsonl`);
  const stopPath = resolve(output, `${nonce}.stop`);
  const queries = new Set<string>();
  const refreshes = new Set<string>();
  let failures = 0;
  let heartbeats = 0;
  let emitted = 0;
  const write = (data: object) => {
    if (emitted++ >= 200) return;
    const entry = JSON.stringify({ at: new Date().toISOString(), ...data });
    appendFileSync(logPath, entry + '\n');
    console.log(entry);
  };
  const audit = (data: AuditEvent) => {
    write(data);
    if (data.event === 'weather-error') failures++;
    if (data.status === 'sent' && data.card === true && typeof data.scene === 'string') {
      if (data.event === 'query-reply') queries.add(data.scene);
      if (data.event === 'refresh-reply') refreshes.add(data.scene);
    }
  };
  const app = await BotFactory.create(createModule(config, { audit }), {
    appId,
    secret,
    commands: { prefix: config.prefix, invalidInput: 'reply' },
    transport: { type: 'ws', closeTimeoutMs: 500, retry: { initialAttempts: 1 } },
    execution: { shutdownTimeoutMs: 5000 },
    logger: {
      debug(message) {
        if (message === 'QQ heartbeat acknowledged') heartbeats++;
      },
      info() {},
      warn() {},
      error() {},
    },
    onError: (error, context) => {
      failures++;
      write({
        event: 'bot-error',
        phase: context.phase,
        code: error instanceof FrameworkError ? error.code : 'ERROR',
        ...(error instanceof QQApiError
          ? {
              status: error.httpStatus,
              ...(typeof error.qqCode === 'number' ? { qqCode: error.qqCode } : {}),
            }
          : {}),
      });
    },
  });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const complete = () =>
    ['private', 'group'].every((scene) => queries.has(scene) && refreshes.has(scene));
  let timer: NodeJS.Timeout | undefined;
  let poll: NodeJS.Timeout | undefined;
  process.once('SIGINT', () => finish());
  process.once('SIGTERM', () => finish());
  try {
    await app.start();
    write({
      event: 'ready',
      commands: [`${config.prefix}启用`, `${config.prefix}查询 北京 天气 今天 通勤 --detail`],
      timeoutSeconds: 600,
      logPath,
      stopPath,
    });
    timer = setTimeout(finish, 600000);
    poll = setInterval(() => {
      if (complete() || existsSync(stopPath)) finish();
    }, 1000);
    await finished;
  } finally {
    clearTimeout(timer);
    clearInterval(poll);
    await app.close();
    write({
      event: 'finished',
      complete: complete(),
      queries: [...queries],
      refreshes: [...refreshes],
      failures,
      heartbeats,
    });
  }
}
live().catch((error: unknown) => {
  console.error(
    JSON.stringify({
      event: 'startup-error',
      code: error instanceof FrameworkError ? error.code : 'ERROR',
    }),
  );
  process.exitCode = 1;
});
