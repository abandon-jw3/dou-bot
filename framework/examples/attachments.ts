import { setImmediate as tick } from 'node:timers/promises';
import {
  Attachments,
  Command,
  Controller,
  Ctx,
  HelpModule,
  Images,
  Module,
  OnAttachment,
  Rest,
  selectAttachments,
} from '../src/index.js';
import type { Attachment, MessageContext } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

// Unreleased source API. Fixtures model image+text or a command followed by a separate attachment.
type UploadKind = 'video' | 'audio' | 'file';
const labels = { video: '视频', audio: '音频', file: '文件' };
async function collect(ctx: MessageContext, kind: UploadKind): Promise<void> {
  const answer = await ctx.prompt(`请单独发送 1 个${labels[kind]}，或发送“取消”。`);
  if (answer.status !== 'received') {
    await ctx.reply(answer.status === 'timeout' ? '等待超时。' : '已取消。');
    return;
  }
  const result = selectAttachments(answer.message.attachments, { kind, minCount: 1, maxCount: 1 });
  if (result.status === 'invalid') {
    await answer.message.reply(`请发送 1 个${labels[kind]}，本条匹配 ${result.count} 个。`);
    return;
  }
  // Selection only reads metadata. Downloading, saving and processing belong to your service.
  await answer.message.reply(`收到 ${result.attachments.length} 个${labels[kind]}。`);
}
@Controller()
class AttachmentCommands {
  // Direct uploads do not need a command. Metadata matching does not verify DOCX contents.
  @OnAttachment({ filename: /^报告_\d{8}\.docx$/u, extension: 'docx', invalidInput: 'reply' })
  report(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
    // Hand the matched files to your own download and document-processing service here.
    return `已接收 ${files.length} 个匹配文件。`;
  }
  @Command('测试图片', { description: '在同一条消息中附带 1～4 张图片，可附文字备注' })
  pictures(
    @Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[],
    @Rest({ name: '备注' }) notes: string[],
  ): string {
    return `收到 ${images.length} 张图片；备注：${notes.join(' ') || '无'}。`;
  }
  @Command('附件') inspect(@Attachments() all: readonly Attachment[]): string {
    return `当前消息有 ${all.length} 个附件。`;
  }
  @Command('处理视频') video(@Ctx() ctx: MessageContext): Promise<void> {
    return collect(ctx, 'video');
  }
  @Command('处理音频') audio(@Ctx() ctx: MessageContext): Promise<void> {
    return collect(ctx, 'audio');
  }
  @Command('处理文件') file(@Ctx() ctx: MessageContext): Promise<void> {
    return collect(ctx, 'file');
  }
}
@Module({ imports: [HelpModule], controllers: [AttachmentCommands] })
class Root {}

const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
try {
  await harness.app.start();
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'picture',
      author: { user_openid: 'user' },
      content: '/测试图片 示例图',
      attachments: [{ url: 'https://example.invalid/photo.png', content_type: 'image/png' }],
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'pictures',
      group_openid: 'group',
      author: { member_openid: 'user' },
      content: '/附件',
      attachments: [{ url: 'https://example.invalid/photo.png', content_type: 'image/png' }],
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'direct-docx',
      author: { user_openid: 'user' },
      content: '',
      attachments: [
        {
          url: 'https://example.invalid/report',
          filename: '报告_20261006.docx',
          content_type: 'file',
        },
      ],
    },
  });
  for (const [kind, contentType] of [
    ['video', 'video/mp4'],
    ['audio', 'voice'],
    ['file', 'file'],
  ] as const) {
    const before = harness.messages.length;
    const start = harness.enqueue({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: `start-${kind}`,
        author: { user_openid: 'user' },
        content: `/处理${labels[kind]}`,
      },
    });
    if (!('done' in start)) throw new Error('Example command was not accepted');
    for (let i = 0; i < 100 && harness.messages.length === before; i++) await tick();
    if (harness.messages.length === before) throw new Error('Example question was not sent');
    const answer = harness.enqueue({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: `answer-${kind}`,
        author: { user_openid: 'user' },
        content: '',
        attachments: [{ url: `https://example.invalid/${kind}`, content_type: contentType }],
      },
    });
    if (!('done' in answer)) throw new Error('Example input was not accepted');
    await Promise.all([start.done, answer.done]);
  }
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'help',
      author: { user_openid: 'user' },
      content: '/help 测试图片',
    },
  });
  for (const message of harness.messages)
    console.log(`${message.target.scene}: ${message.payload.content ?? ''}`);
  const failure = harness.errors[0];
  if (failure) throw failure.error;
} finally {
  await harness.app.close();
}
