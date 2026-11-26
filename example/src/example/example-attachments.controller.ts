import {
  Arg,
  Attachments,
  Command,
  Controller,
  Cooldown,
  Ctx,
  Images,
  OnAttachment,
  Rest,
  selectAttachments,
} from 'dou-bot';
import type { Attachment, AttachmentKind, MessageContext } from 'dou-bot';

@Controller()
export class ExampleAttachmentsController {
  @Command('example-images', { description: '同条发送 1～4 张图片，可附文字备注' })
  images(
    @Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[],
    @Rest({ name: '备注' }) notes: string[],
  ): string {
    return `收到 ${images.length} 张图片；备注：${notes.join(' ') || '无'}。`;
  }

  @Command('example-attachments', { description: '查看当前命令消息的附件数量' })
  attachments(@Attachments({ maxCount: 8 }) files: readonly Attachment[]): string {
    return `当前消息有 ${files.length} 个附件。`;
  }

  @Command('example-upload', { description: '分条接收一个 video、audio 或 file 附件' })
  async upload(
    @Arg(0, { choices: ['video', 'audio', 'file'], required: true, name: '类型' })
    kind: AttachmentKind,
    @Ctx() ctx: MessageContext,
  ): Promise<void> {
    const answer = await ctx.prompt(`请单独发送 1 个 ${kind} 附件，或发送“取消”。`);
    if (answer.status !== 'received') {
      await ctx.reply(answer.status === 'timeout' ? '等待超时。' : '已取消。');
      return;
    }
    const selected = selectAttachments(answer.message.attachments, {
      kind,
      minCount: 1,
      maxCount: 1,
    });
    if (selected.status === 'invalid') {
      await answer.message.reply(
        `请发送 1 个 ${kind} 附件，本条匹配 ${selected.count} 个；本次示例结束。`,
      );
      return;
    }
    // 使用新消息的上下文回复，引用用户刚刚发送的附件；选择不会下载文件。
    await answer.message.reply(`收到 1 个 ${kind} 附件。`);
  }

  @OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx', invalidInput: 'reply' })
  @Cooldown({ scope: 'user', durationMs: 3000 })
  report(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
    // 直接上传即可触发。仅匹配元信息，真正下载、验证和解析 DOCX 应交给业务服务。
    return `已接收匹配文件：${files[0]?.filename}。`;
  }
}
