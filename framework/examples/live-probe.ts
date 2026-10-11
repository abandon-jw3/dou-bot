import { randomBytes } from 'node:crypto';
import {
  Arg,
  BotFactory,
  Command,
  Controller,
  Ctx,
  FrameworkError,
  Module,
  On,
  QQApiError,
} from '../src/index.js';
import type { MessageContext, QQEventContext } from '../src/index.js';
import { isRecord } from '../src/core/utils.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Configure the local QQ environment before the live probe.');
const nonce = randomBytes(4).toString('hex');
const scenes = new Set<string>();
const requestedScenes = process.argv.includes('--group-only') ? ['group'] : ['private', 'group'];
let heartbeats = 0;
let complete!: () => void;
const completed = new Promise<void>((resolve) => {
  complete = resolve;
});
const maybeComplete = () => {
  if (requestedScenes.every((scene) => scenes.has(scene)) && heartbeats >= 2) complete();
};

@Controller()
class Probe {
  @On('GROUP_AT_MESSAGE_CREATE')
  groupAt(@Ctx() context: QQEventContext): void {
    this.observe(context);
  }
  @On('GROUP_MESSAGE_CREATE')
  groupMessage(@Ctx() context: QQEventContext): void {
    this.observe(context);
  }
  private observe(context: QQEventContext): void {
    const data = context.raw.d;
    if (!isRecord(data) || typeof data.content !== 'string' || !data.content.includes(nonce))
      return;
    const mentionPrefix = /^\s*<@!?([A-Za-z0-9_-]+)>/u.exec(data.content);
    const mentions: unknown[] = Array.isArray(data.mentions) ? data.mentions : [];
    console.log(
      JSON.stringify({
        event: 'group-input',
        hasCode: true,
        commandPrefixMatches: data.content.trimStart().startsWith('/ddprobe'),
        contentLength: data.content.length,
        mentionPrefixPresent: !!mentionPrefix,
        mentionFields: mentions.filter(isRecord).map((mention) => Object.keys(mention)),
        prefixMatchesSelf:
          !!mentionPrefix?.[1] &&
          mentions.some(
            (mention) =>
              isRecord(mention) &&
              mention.is_you === true &&
              (mention.id === mentionPrefix[1] || mention.member_openid === mentionPrefix[1]),
          ),
      }),
    );
  }
  @Command('ddprobe')
  async probe(@Arg(0) code: string | undefined, @Ctx() context: MessageContext): Promise<void> {
    if (code !== nonce || scenes.has(context.scene) || !requestedScenes.includes(context.scene))
      return;
    const result = await context.reply(
      `dd-bot 测试成功（${context.scene === 'private' ? '私聊' : '群聊'}）`,
    );
    if (result.status === 'sent') scenes.add(context.scene);
    console.log(JSON.stringify({ event: 'reply', scene: context.scene, status: result.status }));
    maybeComplete();
  }
}
@Module({ controllers: [Probe] })
class ProbeModule {}

const app = await BotFactory.create(ProbeModule, {
  appId,
  secret,
  transport: { type: 'ws', retry: { initialAttempts: 1 }, closeTimeoutMs: 500 },
  execution: { shutdownTimeoutMs: 5000 },
  logger: {
    debug(message, fields) {
      if (message === 'QQ heartbeat acknowledged') {
        heartbeats++;
        console.log(JSON.stringify({ event: 'heartbeat', acknowledgments: heartbeats }));
        maybeComplete();
      } else if (
        message === 'QQ event received' &&
        typeof fields?.type === 'string' &&
        fields.type.includes('GROUP')
      ) {
        console.log(
          JSON.stringify({
            event: 'gateway-group-event',
            type: fields.type,
            fields: fields.fields,
          }),
        );
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
        ...(error instanceof QQApiError
          ? { qqCode: error.qqCode, httpStatus: error.httpStatus }
          : {}),
      }),
    );
  },
});
let timer: NodeJS.Timeout | undefined;
const stop = () => complete();
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  await app.start();
  console.log(
    JSON.stringify({
      event: 'ready',
      command: `/ddprobe ${nonce}`,
      requestedScenes,
      timeoutSeconds: 600,
    }),
  );
  timer = setTimeout(complete, 600000);
  await completed;
} finally {
  clearTimeout(timer);
  await app.close();
  console.log(
    JSON.stringify({
      event: 'finished',
      scenes: [...scenes],
      heartbeatAcknowledgments: heartbeats,
    }),
  );
}
