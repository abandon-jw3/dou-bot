import {
  Attachments,
  Audios,
  Command,
  Controller,
  Files,
  HelpModule,
  Images,
  Module,
  Rest,
  Videos,
} from '../src/index.js';
import type { Attachment } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

// These decorators are unreleased source APIs; the standalone application still uses npm 0.6.0.
@Controller()
class AttachmentCommands {
  @Command('测试图片', { description: '在同一条消息中附带 1～4 张图片，可附文字备注' })
  pictures(
    @Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[],
    @Rest({ name: '备注' }) notes: string[],
  ): string {
    return `收到 ${images.length} 张图片；备注：${notes.join(' ') || '无'}。`;
  }

  @Command('附件', { description: '查看当前消息的附件分类数量' })
  inspect(
    @Attachments() all: readonly Attachment[],
    @Images() images: readonly Attachment[],
    @Videos() videos: readonly Attachment[],
    @Audios() audios: readonly Attachment[],
    @Files() files: readonly Attachment[],
  ): string {
    // Only metadata is selected. Downloading or processing a file belongs to the business service.
    return `附件 ${all.length}；图片 ${images.length}；视频 ${videos.length}；音频 ${audios.length}；文件 ${files.length}。`;
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
      content: '/测试图片 这是一张示例图',
      attachments: [{ url: 'https://example.invalid/photo.png', content_type: 'image/png' }],
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'mixed',
      group_openid: 'group',
      author: { member_openid: 'user' },
      content: '/附件',
      attachments: [
        { url: 'https://example.invalid/photo.png', content_type: 'image/png' },
        {
          url: 'https://example.invalid/voice.silk',
          content_type: 'voice',
          voice_wav_url: 'https://example.invalid/voice.wav',
          asr_refer_text: '参考文本',
        },
        { url: 'https://example.invalid/document.pdf', content_type: 'application/pdf' },
      ],
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'help', author: { user_openid: 'user' }, content: '/help 测试图片' },
  });
  for (const message of harness.messages)
    console.log(`${message.target.scene}: ${message.payload.content ?? ''}`);
  const failure = harness.errors[0];
  if (failure) throw failure.error;
} finally {
  await harness.app.close();
}
