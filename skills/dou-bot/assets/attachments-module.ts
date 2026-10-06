import {
  Arg,
  Attachments,
  Command,
  Controller,
  Ctx,
  HelpModule,
  Images,
  Module,
  OnAttachment,
  selectAttachments,
} from 'dou-bot';
import type { Attachment, AttachmentKind, MessageContext } from 'dou-bot';

@Controller()
class Uploads {
  @Command('收图')
  images(@Images({ minCount: 1, maxCount: 4 }) files: readonly Attachment[]): string {
    return `收到 ${files.length} 张图片。`;
  }

  @Command('上传')
  async upload(
    @Arg(0, { choices: ['video', 'audio', 'file'], required: true }) kind: AttachmentKind,
    @Ctx() ctx: MessageContext,
  ): Promise<void> {
    const answer = await ctx.prompt(`请发送 1 个 ${kind} 附件，或发送“取消”。`);
    if (answer.status !== 'received') {
      await ctx.reply(answer.status === 'timeout' ? '等待超时。' : '已取消。');
      return;
    }
    const result = selectAttachments(answer.message.attachments, {
      kind,
      minCount: 1,
      maxCount: 1,
    });
    if (result.status === 'invalid') {
      await answer.message.reply(
        `本条匹配 ${result.count} 个，请发送 1 个 ${kind} 附件；本次接收结束。`,
      );
      return;
    }
    await answer.message.reply(`收到 1 个 ${kind} 附件。`);
  }

  @OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx', invalidInput: 'reply' })
  report(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
    // 在业务服务中下载、验证和解析文档；本例只确认文件名匹配。
    return `已接收：${files[0]?.filename}。`;
  }
}

@Module({ imports: [HelpModule], controllers: [Uploads] })
export class AppModule {}
