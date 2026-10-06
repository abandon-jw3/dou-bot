import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Attachments,
  Audios,
  Command,
  Controller,
  Ctx,
  Files,
  FrameworkError,
  Images,
  Module,
  Videos,
} from 'dou-bot';
import type { Attachment, AttachmentOptions, MessageContext } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

const options = { name: '图片素材', minCount: 1, maxCount: 1 } satisfies AttachmentOptions;
let called = false;
@Controller()
class AttachmentCommands {
  @Command('attachments') inspect(
    @Images(options) images: readonly Attachment[],
    @Attachments() all: readonly Attachment[],
    @Videos() videos: readonly Attachment[],
    @Audios() audios: readonly Attachment[],
    @Files() files: readonly Attachment[],
    @Arg(0) label: string,
    @Ctx() ctx: MessageContext,
  ): string {
    called = true;
    assert.equal(label, 'label');
    assert.deepEqual(
      [all.length, images.length, videos.length, audios.length, files.length],
      [5, 1, 1, 1, 2],
    );
    assert.ok([all, images, videos, audios, files].every(Object.isFrozen));
    assert.notEqual(all, ctx.attachments);
    assert.equal(images[0], ctx.attachments[0]);
    assert.equal(audios[0]?.voiceWavUrl, 'https://example.invalid/voice.wav');
    assert.equal(audios[0]?.asrReferText, '参考文字');
    return 'attachments accepted';
  }
}
@Module({ controllers: [AttachmentCommands] })
class Root {}
const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
await harness.app.start();
try {
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'missing', author: { user_openid: 'user' }, content: '/attachments label' },
  });
  await tick();
  assert.equal(called, false);
  assert.equal(harness.errors.length, 1);
  const error = harness.errors[0]?.error;
  assert.ok(error instanceof FrameworkError && error.code === 'PARAMETER_PARSE');
  await harness.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'mixed',
      group_openid: 'group',
      author: { member_openid: 'user' },
      content: '/attachments label extra-legacy-argument',
      attachments: [
        { url: 'https://example.invalid/image.png', content_type: 'IMAGE/PNG' },
        { url: 'https://example.invalid/video.mp4', content_type: 'video/mp4' },
        {
          url: 'https://example.invalid/voice.silk',
          content_type: 'voice',
          voice_wav_url: 'https://example.invalid/voice.wav',
          asr_refer_text: '参考文字',
        },
        { url: 'https://example.invalid/file', content_type: 'file' },
        { url: 'https://example.invalid/document.pdf', content_type: 'application/pdf' },
      ],
    },
  });
  assert.equal(called, true);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.messages.at(-1)?.payload.content, 'attachments accepted');
} finally {
  await harness.app.close();
}
console.log('Attachment decorators and voice metadata verified in the independent consumer.');
