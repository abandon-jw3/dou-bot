import {
  Attachments,
  Command,
  Controller,
  Ctx,
  FrameworkError,
  Images,
  Injectable,
  Module,
  QQApiError,
  UseGuards,
  selectAttachments,
} from '../src/index.js';
import type {
  Attachment,
  BotApplication,
  CanActivate,
  ErrorContext,
  GuardContext,
  MessageContext,
  MessageTarget,
} from '../src/index.js';

export type AttachmentProbeRecord = Readonly<Record<string, string | number | boolean>>;
type Kind = 'attachments' | 'images' | 'videos' | 'audios' | 'files';
type Scene = 'private' | 'group';
const labels: Record<Kind, string> = {
  attachments: '附件',
  images: '图片',
  videos: '视频',
  audios: '音频',
  files: '文件',
};

/** A fresh instance is created per live run; identifiers and file contents stay out of records. */
export function createAttachmentsProbe(
  nonce: string,
  record: (entry: AttachmentProbeRecord) => void,
) {
  if (!/^[a-f0-9]{6}$/u.test(nonce)) throw new Error('Invalid attachment probe token');
  const commands = Object.fromEntries(
    Object.entries(labels).map(([kind, label]) => [kind, `${label}-${nonce}`]),
  ) as Record<Kind, string>;
  const actors = new Map<Scene, { userId: string; target: MessageTarget }>();
  const messages = new Map<string, { scene: Scene; kind: Kind }>();
  let admittedCommands = 0;
  let emissions = 0;
  const note = (entry: AttachmentProbeRecord) => {
    if (emissions++ < 300) record(entry);
  };
  function matches(target: MessageTarget): boolean {
    const actor = actors.get(target.scene);
    if (!actor) return false;
    return target.scene === 'group'
      ? actor.target.scene === 'group' && target.groupId === actor.target.groupId
      : actor.target.scene === 'private' && target.userId === actor.target.userId;
  }
  @Injectable()
  class SessionGuard implements CanActivate {
    canActivate(ctx: GuardContext): boolean {
      if (ctx.kind !== 'command' || admittedCommands >= 100) return false;
      const kind = (Object.keys(commands) as Kind[]).find((kind) => commands[kind] === ctx.route);
      if (!kind) return false;
      let actor = actors.get(ctx.scene);
      if (!actor) {
        actor = { userId: ctx.userId, target: { ...ctx.target } };
        actors.set(ctx.scene, actor);
      }
      if (actor.userId !== ctx.userId || !matches(ctx.target)) return false;
      admittedCommands++;
      messages.set(ctx.messageId, { scene: ctx.scene, kind });
      note({ event: 'received', scene: ctx.scene, kind, attachments: ctx.attachments.length });
      return true;
    }
  }
  function inspect(kind: Kind, files: readonly Attachment[], ctx: MessageContext): string {
    const types = files.slice(0, 16).map((file) => {
      const type = file.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? 'missing';
      return /^(?:voice|file|[a-z0-9.+_-]+\/[a-z0-9.+_-]+)$/u.test(type) ? type : 'unknown';
    });
    note({
      event: 'selected',
      scene: ctx.scene,
      kind,
      count: files.length,
      contentTypes: types.join(','),
      frozen: Object.isFrozen(files),
      hasVoiceWavUrl: files.some((file) => file.voiceWavUrl !== undefined),
      hasAsrReferText: files.some((file) => file.asrReferText !== undefined),
    });
    return `附件验证：收到 ${files.length} 个${labels[kind]}。`;
  }
  async function collect(kind: 'videos' | 'audios' | 'files', ctx: MessageContext): Promise<void> {
    const info = { scene: ctx.scene, kind };
    note({ event: 'waiting', ...info });
    const answer = await ctx.prompt(`请单独发送 1 个${labels[kind]}，或发送“取消”。`);
    if (answer.status !== 'received') {
      note({ event: answer.status, ...info });
      await ctx.reply(answer.status === 'timeout' ? '附件验证：等待超时。' : '附件验证：已取消。');
      return;
    }
    // Each admitted command owns at most one input; these records remain bounded by 200 entries.
    messages.set(answer.message.messageId, info);
    note({ event: 'input-received', ...info, attachments: answer.message.attachments.length });
    const selection = selectAttachments(answer.message.attachments, {
      kind: kind === 'videos' ? 'video' : kind === 'audios' ? 'audio' : 'file',
      minCount: 1,
      maxCount: 1,
    });
    if (selection.status === 'invalid') {
      note({
        event: 'invalid',
        ...info,
        reason: selection.reason,
        count: selection.count,
        limit: selection.limit,
      });
      await answer.message.reply(
        `附件验证：请发送 1 个${labels[kind]}（本条匹配 ${selection.count} 个）。`,
      );
      return;
    }
    await answer.message.reply(inspect(kind, selection.attachments, answer.message));
  }
  @Controller()
  @UseGuards(SessionGuard)
  class Commands {
    @Command(commands.images) images(
      @Images({ minCount: 1, maxCount: 4 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('images', files, ctx);
    }
    @Command(commands.videos) videos(@Ctx() ctx: MessageContext): Promise<void> {
      return collect('videos', ctx);
    }
    @Command(commands.audios) audios(@Ctx() ctx: MessageContext): Promise<void> {
      return collect('audios', ctx);
    }
    @Command(commands.files) files(@Ctx() ctx: MessageContext): Promise<void> {
      return collect('files', ctx);
    }
    @Command(commands.attachments) attachments(
      @Attachments({ minCount: 1, maxCount: 8 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('attachments', files, ctx);
    }
  }
  @Module({ controllers: [Commands], providers: [SessionGuard] })
  class Root {}
  return {
    root: Root,
    inputModes: Object.freeze({
      attachments: 'same-message',
      images: 'same-message',
      videos: 'next-message',
      audios: 'next-message',
      files: 'next-message',
    }),
    commands: Object.fromEntries(
      Object.entries(commands).map(([kind, name]) => [kind, `/${name}`]),
    ) as Record<Kind, string>,
    onError(error: Error, context: ErrorContext): void {
      const info = context.messageId ? messages.get(context.messageId) : undefined;
      note({
        event: 'error',
        phase: context.phase,
        code: error instanceof FrameworkError ? error.code : 'ERROR',
        ...(info ?? {}),
        ...(error instanceof QQApiError
          ? {
              httpStatus: error.httpStatus ?? 0,
              ...(typeof error.qqCode === 'number' ? { qqCode: error.qqCode } : {}),
            }
          : {}),
      });
    },
    instrument(app: BotApplication): () => void {
      const send = app.client.sendMessage.bind(app.client);
      app.client.sendMessage = async (target, input, options) => {
        const result = await send(target, input, options);
        const info = options?.reply ? messages.get(options.reply.messageId) : undefined;
        if (info) note({ event: 'reply', ...info, status: result.status });
        return result;
      };
      return () => {
        app.client.sendMessage = send;
      };
    },
  };
}
