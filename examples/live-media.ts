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
  OnButton,
  QQApiError,
  button,
  image,
  keyboard,
  markdown,
} from '../src/index.js';
import type { ButtonContext, MessageContext, MessageInput, QQEventContext } from '../src/index.js';
import { fixtureImage } from './fixture-image.js';
import { isRecord } from '../src/core/utils.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Configure local QQ credentials before the media probe.');
const nonce = randomBytes(4).toString('hex');
const prefix = process.argv.includes('--no-prefix') ? '' : '/';
const buttonsOnly = process.argv.includes('--buttons-only');
const requested = process.argv.includes('--group-only') ? ['group'] : ['private', 'group'];
const started = new Set<string>();
const attempted = new Set<string>();
const pendingButtons = new Set<string>();
const outcomes: Record<string, unknown>[] = [];
let heartbeats = 0;
let finish!: () => void;
const finished = new Promise<void>((resolve) => {
  finish = resolve;
});
const maybeFinish = () => {
  if (requested.every((scene) => attempted.has(scene)) && !pendingButtons.size && heartbeats >= 2)
    finish();
};
function failure(error: unknown): Record<string, unknown> {
  return {
    code: error instanceof FrameworkError ? error.code : 'ERROR',
    ...(error instanceof QQApiError
      ? {
          qqCode:
            typeof error.qqCode === 'number' ||
            (typeof error.qqCode === 'string' && /^\d+$/u.test(error.qqCode))
              ? error.qqCode
              : undefined,
          httpStatus: error.httpStatus,
          hasTraceId: !!error.traceId,
        }
      : {}),
  };
}

@Controller()
class MediaProbe {
  @On('INTERACTION_CREATE')
  inspect(@Ctx() context: QQEventContext): void {
    const data = context.raw.d;
    if (
      !isRecord(data) ||
      !isRecord(data.data) ||
      !isRecord(data.data.resolved) ||
      data.data.resolved.button_data !== nonce
    )
      return;
    console.log(
      JSON.stringify({
        event: 'interaction-input',
        chatType: data.chat_type,
        fields: Object.keys(data),
        hasPrivateUser: typeof data.user_openid === 'string',
        hasGroupMember: typeof data.group_member_openid === 'string',
      }),
    );
  }
  @Command('ddmedia')
  async probe(@Arg(0) code: string | undefined, @Ctx() context: MessageContext): Promise<void> {
    if (code !== nonce || !requested.includes(context.scene) || started.has(context.scene)) return;
    started.add(context.scene);
    const sends: [string, MessageInput][] = [
      ['image', image(fixtureImage(), { caption: 'dd-bot 图片测试：彩色方格' })],
      ['markdown', markdown('**dd-bot Markdown 测试成功**\n\n请确认这段文字有加粗显示。')],
      [
        'button',
        markdown('dd-bot 按钮测试：请点击下面的确认按钮。', {
          keyboard: keyboard([[button.callback('dd-media-confirm', '确认按钮', nonce)]]),
        }),
      ],
    ];
    for (const [kind, message] of sends) {
      if (buttonsOnly && kind !== 'button') continue;
      if (kind === 'button') pendingButtons.add(context.scene);
      try {
        const result = await context.reply(message);
        const outcome = { scene: context.scene, kind, status: result.status };
        outcomes.push(outcome);
        console.log(JSON.stringify({ event: 'media-result', ...outcome }));
        if (kind === 'button' && result.status !== 'sent') pendingButtons.delete(context.scene);
      } catch (error) {
        if (kind === 'button') pendingButtons.delete(context.scene);
        const outcome = { scene: context.scene, kind, status: 'failed', ...failure(error) };
        outcomes.push(outcome);
        console.log(JSON.stringify({ event: 'media-result', ...outcome }));
      }
    }
    attempted.add(context.scene);
    maybeFinish();
  }

  @OnButton('dd-media-confirm')
  async clicked(@Ctx() context: ButtonContext): Promise<void> {
    if (context.data !== nonce || !pendingButtons.has(context.scene)) return;
    try {
      await context.ack();
      outcomes.push({ scene: context.scene, kind: 'button-ack', status: 'acknowledged' });
      console.log(
        JSON.stringify({ event: 'button-ack', scene: context.scene, status: 'acknowledged' }),
      );
    } catch (error) {
      outcomes.push({
        scene: context.scene,
        kind: 'button-ack',
        status: 'failed',
        ...failure(error),
      });
    }
    pendingButtons.delete(context.scene);
    maybeFinish();
  }
}
@Module({ controllers: [MediaProbe] })
class Root {}
const app = await BotFactory.create(Root, {
  appId,
  secret,
  commands: { prefix },
  transport: { type: 'ws', retry: { initialAttempts: 1 }, closeTimeoutMs: 500 },
  execution: { shutdownTimeoutMs: 5000 },
  logger: {
    debug(message) {
      if (message === 'QQ heartbeat acknowledged') {
        heartbeats++;
        maybeFinish();
      }
    },
    info() {},
    warn() {},
    error() {},
  },
  onError(error, context) {
    console.log(JSON.stringify({ event: 'error', phase: context.phase, ...failure(error) }));
  },
});
process.once('SIGINT', finish);
process.once('SIGTERM', finish);
let timer: NodeJS.Timeout | undefined;
try {
  await app.start();
  console.log(
    JSON.stringify({
      event: 'ready',
      command: `${prefix}ddmedia ${nonce}`,
      buttonsOnly,
      requestedScenes: requested,
      timeoutSeconds: 600,
    }),
  );
  timer = setTimeout(finish, 600000);
  await finished;
} finally {
  clearTimeout(timer);
  await app.close();
  console.log(
    JSON.stringify({ event: 'finished', outcomes, heartbeatAcknowledgments: heartbeats }),
  );
}
