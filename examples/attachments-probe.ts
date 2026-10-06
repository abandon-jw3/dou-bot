import {
  Attachments,
  Audios,
  Command,
  Controller,
  Ctx,
  Files,
  FrameworkError,
  Images,
  Injectable,
  Module,
  QQApiError,
  UseGuards,
  Videos,
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
      if (ctx.kind !== 'command' || messages.size >= 100) return false;
      const kind = (Object.keys(commands) as Kind[]).find((kind) => commands[kind] === ctx.route);
      if (!kind) return false;
      let actor = actors.get(ctx.scene);
      if (!actor) {
        actor = { userId: ctx.userId, target: { ...ctx.target } };
        actors.set(ctx.scene, actor);
      }
      if (actor.userId !== ctx.userId || !matches(ctx.target)) return false;
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
  @Controller()
  @UseGuards(SessionGuard)
  class Commands {
    @Command(commands.images) images(
      @Images({ minCount: 1, maxCount: 4 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('images', files, ctx);
    }
    @Command(commands.videos) videos(
      @Videos({ minCount: 1, maxCount: 2 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('videos', files, ctx);
    }
    @Command(commands.audios) audios(
      @Audios({ minCount: 1, maxCount: 2 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('audios', files, ctx);
    }
    @Command(commands.files) files(
      @Files({ minCount: 1, maxCount: 4 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      return inspect('files', files, ctx);
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
