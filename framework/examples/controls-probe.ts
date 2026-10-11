import {
  Command,
  Controller,
  Cooldown,
  Ctx,
  Injectable,
  Module,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
  button,
  keyboard,
  markdown,
} from '../src/index.js';
import type {
  BotApplication,
  ButtonContext,
  CanActivate,
  ErrorContext,
  GuardContext,
  GuardResult,
  MessageContext,
  MessageInput,
  MessageTarget,
} from '../src/index.js';
import { FrameworkError, QQApiError } from '../src/index.js';
import { City } from './business/city.decorator.js';
import { QueryService } from './business/query.service.js';
import type { Topic } from './business/query.service.js';

type Scene = 'private' | 'group';
type Actor = { userId: string; target: MessageTarget };
export type ProbeRecord = Readonly<Record<string, string | number | boolean>>;
export const controlCooldownHint = '冷却拦截成功：本次没有执行查询，请在 30 秒后再试。';
const rejectHint = 'Guard 拒绝成功：本次没有执行查询。';
const denyButtonHint = '拒绝按钮拦截成功：已确认收到点击，业务没有执行。';
const allowedButtonHint = '允许按钮执行成功：已确认收到点击。';

/** A live-only enrollment token; private identity values stay in memory and never reach records. */
export function createControlsProbe(nonce: string, record: (entry: ProbeRecord) => void) {
  if (!/^[a-f0-9]{8}$/u.test(nonce)) throw new Error('Invalid probe token');
  const command = `验收-${nonce}`;
  const alias = `复测-${nonce}`;
  const allowId = `dd-allow-${nonce}`;
  const denyId = `dd-deny-${nonce}`;
  const actors = new Map<Scene, Actor>();
  const messages = new Map<string, Scene>();
  const interactions = new Map<string, { scene: Scene; button: 'allow' | 'deny' }>();
  const stages = new Map<Scene, Set<string>>();
  let emissions = 0;
  let deniedHandlerCalls = 0;
  const note = (event: string, scene: Scene, fields: ProbeRecord = {}) => {
    if (emissions++ < 200) record({ event, scene, ...fields });
  };
  const mark = (scene: Scene, stage: string) => {
    const flags = stages.get(scene) ?? new Set<string>();
    flags.add(stage);
    stages.set(scene, flags);
  };
  const targetScene = (target: MessageTarget): Scene | undefined => {
    const actor = actors.get(target.scene);
    if (!actor) return undefined;
    return target.scene === 'private'
      ? actor.target.scene === 'private' && actor.target.userId === target.userId
        ? target.scene
        : undefined
      : actor.target.scene === 'group' && actor.target.groupId === target.groupId
        ? target.scene
        : undefined;
  };

  @Injectable()
  class SessionGuard implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      let actor = actors.get(ctx.scene);
      const words = ctx.kind === 'command' ? ctx.content.trim().split(/\s+/u) : [];
      if (!actor && ctx.kind === 'command' && words[1] === '拒绝') {
        actor = { userId: ctx.userId, target: { ...ctx.target } };
        actors.set(ctx.scene, actor);
        note('enrolled', ctx.scene);
      }
      if (!actor || actor.userId !== ctx.userId || targetScene(ctx.target) !== ctx.scene)
        return false;
      if (ctx.kind === 'button') {
        if (ctx.data !== nonce || interactions.size >= 100) return false;
        interactions.set(ctx.interactionId, {
          scene: ctx.scene,
          button: ctx.buttonId === denyId ? 'deny' : 'allow',
        });
        note('button-received', ctx.scene, { button: ctx.buttonId === denyId ? 'deny' : 'allow' });
      } else {
        if (messages.size >= 100) return false;
        messages.set(ctx.messageId, ctx.scene);
        note('command-received', ctx.scene, { rejectionCase: words[1] === '拒绝' });
        if (words[1] === '拒绝') {
          note('guard-denied', ctx.scene, { kind: 'command' });
          return { allow: false, message: rejectHint };
        }
      }
      return true;
    }
  }
  @Injectable()
  class DenyButtonGuard implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      note('guard-denied', ctx.scene, { kind: 'button' });
      return { allow: false, message: denyButtonHint };
    }
  }
  @Controller()
  @UseGuards(SessionGuard)
  class ProbeController {
    constructor(private readonly queries: QueryService) {}
    @Command(command, { aliases: [alias] })
    @Cooldown({ scope: 'user', durationMs: 30000, message: controlCooldownHint })
    async query(
      @City() city: string,
      @Slot('topic', { name: '查询类型', required: true, choices: ['天气', '空气质量'] })
      topic: Topic,
      @Rest({ name: '补充内容' }) remaining: string[],
      @Option('detail', { type: 'boolean', default: false }) detail: boolean,
      @Ctx() ctx: MessageContext,
    ): Promise<void> {
      const expected =
        city === '北京' &&
        topic === '天气' &&
        remaining.length === 1 &&
        remaining[0] === '今天' &&
        detail;
      note('query-executed', ctx.scene, { expectedArguments: expected });
      const result = await ctx.reply(
        markdown(
          [
            `**0.3.0 实机测试（${ctx.scene === 'private' ? '私聊' : '群聊'}）**`,
            `城市：${city}；类型：${topic}`,
            `剩余参数：${remaining.join('、') || '无'}；详细：${detail ? '是' : '否'}`,
            this.queries.query(city, topic, remaining, detail),
            '请先发送复测命令验证冷却，再分别点击下面两个按钮。',
          ].join('\n\n'),
          {
            keyboard: keyboard([
              [
                button.callback(allowId, '允许按钮', nonce),
                button.callback(denyId, '拒绝按钮', nonce),
              ],
            ]),
          },
        ),
      );
      note('query-result', ctx.scene, { status: result.status });
      if (result.status === 'sent' && expected) mark(ctx.scene, 'query');
    }
    @OnButton(allowId)
    @Cooldown({ scope: 'user', durationMs: 30000, message: '按钮冷却拦截成功：请稍后再点。' })
    async allow(@Ctx() ctx: ButtonContext): Promise<void> {
      note('allowed-button-executed', ctx.scene);
      await ctx.ack();
      await ctx.send(allowedButtonHint);
    }
    @OnButton(denyId)
    @UseGuards(DenyButtonGuard)
    deny(): void {
      deniedHandlerCalls++;
      throw new Error('Rejected button unexpectedly reached its handler');
    }
  }
  @Module({
    providers: [SessionGuard, DenyButtonGuard, QueryService],
    controllers: [ProbeController],
  })
  class ProbeModule {}

  const required = [
    'guard-denied',
    'input-rejected',
    'query',
    'cooldown',
    'allow-ack',
    'deny-ack',
    'allow-hint',
    'deny-hint',
  ];
  return {
    root: ProbeModule,
    command,
    alias,
    commands: [
      `${command} 拒绝`,
      `${command} 北京`,
      `${command} 今天 天气 北京 --detail`,
      `${alias} 天气 北京`,
    ],
    complete: () =>
      ['private', 'group'].every((scene) =>
        required.every((stage) => stages.get(scene as Scene)?.has(stage)),
      ) && deniedHandlerCalls === 0,
    summary: () =>
      Object.fromEntries(
        ['private', 'group'].map((scene) => [
          scene,
          Object.fromEntries(
            required.map((stage) => [stage, stages.get(scene as Scene)?.has(stage) ?? false]),
          ),
        ]),
      ),
    onError(error: Error, context: ErrorContext): void {
      const scene = context.messageId ? messages.get(context.messageId) : undefined;
      if (
        scene &&
        context.phase === 'command' &&
        error instanceof FrameworkError &&
        error.code === 'PARAMETER_PARSE'
      ) {
        note('input-rejected', scene);
        mark(scene, 'input-rejected');
      } else {
        record({
          event: 'error',
          phase: context.phase,
          code: error instanceof FrameworkError ? error.code : 'ERROR',
          ...(error instanceof QQApiError
            ? {
                httpStatus: error.httpStatus ?? 0,
                ...(typeof error.qqCode === 'number' ? { qqCode: error.qqCode } : {}),
                hasTraceId: !!error.traceId,
              }
            : {}),
        });
      }
    },
    instrument(app: BotApplication): () => void {
      const client = app.client;
      const send = client.sendMessage.bind(client);
      const api = client.api;
      const ack = api.acknowledgeInteraction.bind(api);
      // Observe the SDK's already-validated results; never bypass transport or API validation.
      client.sendMessage = async (target, input, options) => {
        const result = await send(target, input, options);
        const scene = targetScene(target);
        const content = messageText(input);
        const stage =
          content === rejectHint
            ? 'guard-denied'
            : content === controlCooldownHint
              ? 'cooldown'
              : content === allowedButtonHint
                ? 'allow-hint'
                : content === denyButtonHint
                  ? 'deny-hint'
                  : undefined;
        if (scene && stage) {
          note('hint-result', scene, { stage, status: result.status });
          if (result.status === 'sent') mark(scene, stage);
        }
        return result;
      };
      api.acknowledgeInteraction = async (id, code, options) => {
        await ack(id, code, options);
        const interaction = interactions.get(id);
        if (interaction) {
          note('button-acknowledged', interaction.scene, { button: interaction.button });
          mark(interaction.scene, `${interaction.button}-ack`);
        }
      };
      return () => {
        client.sendMessage = send;
        api.acknowledgeInteraction = ack;
      };
    },
  };
}

function messageText(input: MessageInput): string | undefined {
  return typeof input === 'string' ? input : input.kind === 'text' ? input.content : undefined;
}
