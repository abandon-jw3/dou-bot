import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import * as sdk from 'dou-bot';
import {
  Arg,
  Attachments,
  Command,
  Controller,
  Ctx,
  FrameworkError,
  Images,
  Module,
  selectAttachments,
} from 'dou-bot';
import type {
  Attachment,
  AttachmentKind,
  AttachmentOptions,
  AttachmentSelectionOptions,
  AttachmentSelectionResult,
  MessageContext,
  QQDispatch,
} from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

for (const name of ['Videos', 'Audios', 'Files']) assert.equal(Object.hasOwn(sdk, name), false);
const options = { name: '图片素材', minCount: 1, maxCount: 1 } satisfies AttachmentOptions;
let called = false;
function selected(all: readonly Attachment[], kind: AttachmentKind): readonly Attachment[] {
  const result: AttachmentSelectionResult = selectAttachments(all, {
    kind,
  } satisfies AttachmentSelectionOptions);
  assert.ok(result.status === 'valid');
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.attachments));
  return result.attachments;
}
@Controller()
class AttachmentCommands {
  @Command('attachments') inspect(
    @Images(options) images: readonly Attachment[],
    @Attachments() all: readonly Attachment[],
    @Arg(0) label: string,
    @Ctx() ctx: MessageContext,
  ): string {
    called = true;
    assert.equal(label, 'label');
    assert.deepEqual(
      [
        all.length,
        images.length,
        ...(['video', 'audio', 'file'] as const).map((kind) => selected(all, kind).length),
      ],
      [5, 1, 1, 1, 2],
    );
    assert.ok(Object.isFrozen(images) && Object.isFrozen(all));
    assert.notEqual(all, ctx.attachments);
    assert.equal(images[0], ctx.attachments[0]);
    assert.equal(selected(all, 'audio')[0]?.voiceWavUrl, 'https://example.invalid/voice.wav');
    assert.equal(selected(all, 'audio')[0]?.asrReferText, '参考文字');
    return 'attachments accepted';
  }
  @Command('collect') async collect(
    @Arg(0, { choices: ['video', 'audio', 'file'], required: true }) kind: AttachmentKind,
    @Ctx() ctx: MessageContext,
  ): Promise<void> {
    const answer = await ctx.prompt(`send-${kind}`);
    assert.ok(answer.status === 'received');
    const result = selectAttachments(answer.message.attachments, {
      kind,
      minCount: 1,
      maxCount: 1,
    });
    assert.ok(result.status === 'valid');
    await answer.message.reply(`received-${kind}:${result.attachments.length}`);
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
  assert.equal(called, false);
  assert.equal(harness.errors.length, 1);
  const error = harness.errors[0]?.error;
  assert.ok(error instanceof FrameworkError && error.code === 'PARAMETER_PARSE');
  // A synthetic protocol robustness fixture, not a QQ client composition example.
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
  assert.equal(harness.messages.at(-1)?.payload.content, 'attachments accepted');
  const invalid = selectAttachments([], { kind: 'file', minCount: 1 });
  assert.deepEqual(invalid, { status: 'invalid', reason: 'too-few', count: 0, limit: 1 });
  assert.ok(Object.isFrozen(invalid));
  for (const scene of ['private', 'group']) {
    for (const [kind, contentType] of [
      ['video', 'video/mp4'],
      ['audio', 'voice'],
      ['file', 'file'],
    ]) {
      const identity =
        scene === 'private'
          ? { author: { user_openid: 'user' } }
          : { author: { member_openid: 'user' }, group_openid: 'group' };
      const t = scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE';
      const before = harness.messages.length;
      const start = harness.enqueue({
        op: 0,
        t,
        d: { id: `start-${scene}-${kind}`, ...identity, content: `/collect ${kind}` },
      });
      assert.ok('done' in start);
      for (let i = 0; i < 100 && harness.messages.length === before; i++) await tick();
      assert.equal(harness.messages.length, before + 1);
      const payload: QQDispatch = {
        op: 0,
        t,
        d: {
          id: `input-${scene}-${kind}`,
          ...identity,
          content: '',
          attachments: [{ url: 'https://example.invalid/input', content_type: contentType }],
        },
      };
      const answer = harness.enqueue(payload);
      assert.ok('done' in answer);
      await Promise.all([start.done, answer.done]);
      assert.equal(harness.messages.at(-1)?.payload.content, `received-${kind}:1`);
      assert.equal(harness.messages.at(-1)?.payload.msg_id, `input-${scene}-${kind}`);
    }
  }
  assert.equal(harness.errors.length, 1);
} finally {
  await harness.app.close();
}
console.log(
  'Attachment selection and explicit media prompts verified in the independent consumer.',
);
