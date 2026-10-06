import assert from 'node:assert/strict';
import test from 'node:test';
import * as sdk from '../src/index.js';
import {
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  Injectable,
  Module,
  UseGuards,
  selectAttachments,
} from '../src/index.js';
import type {
  Attachment,
  AttachmentKind,
  AttachmentSelectionOptions,
  CanActivate,
  GuardResult,
  MessageContext,
  QQDispatch,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { until } from './helpers.js';

function file(contentType?: string, filename = 'file'): Attachment {
  return {
    url: `https://example.invalid/${filename}`,
    filename,
    raw: { content_type: contentType },
    ...(contentType === undefined ? {} : { contentType }),
  };
}
function contractError(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT';
}

await test('public attachment selection supports all kinds while preserving original metadata, order and duplicates', () => {
  const image = file(' Image/JPEG ; charset=binary', 'image');
  const voice = {
    ...file('VOICE', 'voice'),
    voiceWavUrl: 'https://example.invalid/voice.wav',
    asrReferText: 'reference',
  };
  const values = [
    image,
    file('video/mp4;codecs=avc1', 'video'),
    voice,
    file('audio/ogg', 'audio'),
    file(' File ', 'file'),
    file('application/pdf', 'pdf'),
    file('text/plain', 'text'),
    image,
    file(undefined, 'missing.png'),
    file('unknown', 'unknown.mp4'),
    file('image/*', 'range'),
    file('image/', 'incomplete'),
    file('image/p ng', 'space'),
  ];
  const expected: Record<AttachmentKind, string[]> = {
    all: values.map((value) => value.filename!),
    image: ['image', 'image'],
    video: ['video'],
    audio: ['voice', 'audio'],
    file: ['file', 'pdf', 'text'],
  };
  for (const kind of Object.keys(expected) as AttachmentKind[]) {
    const result = selectAttachments(values, { kind });
    assert.ok(result.status === 'valid');
    assert.deepEqual(
      result.attachments.map((value) => value.filename),
      expected[kind],
    );
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.attachments));
    assert.notEqual(result.attachments, values);
    assert.ok(result.attachments.every((value) => values.includes(value)));
  }
  const audios = selectAttachments(values, { kind: 'audio' });
  assert.ok(audios.status === 'valid');
  assert.equal(audios.attachments[0], voice);
  assert.equal(voice.contentType, 'VOICE');
  assert.equal(image.contentType, ' Image/JPEG ; charset=binary');
  assert.equal(voice.asrReferText, 'reference');
  assert.deepEqual(values[2]?.raw, { content_type: 'VOICE' });
});

await test('selection defaults and bounds return immutable results without truncating or throwing for ordinary input', () => {
  const image = file('image/png');
  const one = selectAttachments([image]);
  const two = selectAttachments([image]);
  assert.ok(one.status === 'valid' && two.status === 'valid');
  assert.notEqual(one, two);
  assert.notEqual(one.attachments, two.attachments);
  assert.throws(() => Object.assign(one, { status: 'invalid' }), TypeError);
  assert.throws(() => Object.assign(one.attachments, { 0: file('file') }), TypeError);
  assert.deepEqual(selectAttachments([]), { status: 'valid', attachments: [] });
  assert.deepEqual(selectAttachments([image], { kind: 'file' }), {
    status: 'valid',
    attachments: [],
  });
  assert.deepEqual(selectAttachments([image], { kind: 'file', minCount: 1 }), {
    status: 'invalid',
    reason: 'too-few',
    count: 0,
    limit: 1,
  });
  const inputs = [image, file('file'), file('image/jpeg')];
  const valid = selectAttachments(inputs, { kind: 'image', minCount: 2, maxCount: 2 });
  assert.ok(valid.status === 'valid');
  assert.equal(valid.attachments.length, 2);
  const invalid = selectAttachments(inputs, { kind: 'image', maxCount: 1 });
  assert.deepEqual(invalid, { status: 'invalid', reason: 'too-many', count: 2, limit: 1 });
  assert.ok(Object.isFrozen(invalid));
  assert.equal('attachments' in invalid, false);
  assert.equal(inputs.length, 3);
  assert.deepEqual(selectAttachments([], { maxCount: 0 }), { status: 'valid', attachments: [] });
  assert.deepEqual(selectAttachments([image], { maxCount: 0 }), {
    status: 'invalid',
    reason: 'too-many',
    count: 1,
    limit: 0,
  });
  assert.deepEqual(selectAttachments([], { minCount: Number.MAX_SAFE_INTEGER }), {
    status: 'invalid',
    reason: 'too-few',
    count: 0,
    limit: Number.MAX_SAFE_INTEGER,
  });
});

await test('selection rejects invalid call options and raw payloads as handler contract errors', () => {
  const badOptions: unknown[] = [
    null,
    [],
    'image',
    { kind: 'IMAGE' },
    { kind: 'toString' },
    { kind: 'image/png' },
    { kind: null },
    { kind: 1 },
    { required: true },
    { name: 'name' },
    { minCount: 2, maxCount: 1 },
  ];
  for (const key of ['minCount', 'maxCount']) {
    for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '1'])
      badOptions.push({ [key]: value });
  }
  for (const options of badOptions)
    assert.throws(
      () => selectAttachments([], options as AttachmentSelectionOptions),
      contractError,
    );
  for (const input of [
    null,
    {},
    '',
    Array(1),
    [null],
    [{ url: 'raw', content_type: 'voice' }],
    [{ url: 1, raw: {} }],
    [{ url: 'u', raw: null }],
    [{ url: 'u', raw: {}, contentType: 1 }],
  ]) {
    assert.throws(() => selectAttachments(input as readonly Attachment[]), contractError);
  }
});

await test('selection reads only the supplied normalized array and never walks raw nested data', () => {
  const raw = {
    attachments: [{ url: 'nested', content_type: 'video/mp4' }],
    asr_refer_text: '/run',
  };
  const attachment: Attachment = { url: 'https://example.invalid/movie.mp4', raw };
  assert.deepEqual(selectAttachments([attachment], { kind: 'video' }), {
    status: 'valid',
    attachments: [],
  });
  const all = selectAttachments([attachment]);
  assert.ok(all.status === 'valid');
  assert.equal(all.attachments[0], attachment);
  assert.equal(all.attachments[0]?.raw, raw);
  assert.deepEqual(selectAttachments([], { kind: 'video', minCount: 1 }), {
    status: 'invalid',
    reason: 'too-few',
    count: 0,
    limit: 1,
  });
});

await test('only the two same-message decorators are exported and invalid selection does not send or report', async (t) => {
  for (const name of ['Videos', 'Audios', 'Files']) assert.equal(Object.hasOwn(sdk, name), false);
  assert.equal(typeof sdk.Images, 'function');
  assert.equal(typeof sdk.Attachments, 'function');
  let calls = 0;
  @Controller()
  class Commands {
    @Command('check') check(@Ctx() ctx: MessageContext): void {
      calls++;
      assert.deepEqual(selectAttachments(ctx.attachments, { kind: 'file', minCount: 1 }), {
        status: 'invalid',
        reason: 'too-few',
        count: 0,
        limit: 1,
      });
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'one', author: { user_openid: 'user' }, content: '/check' },
  });
  assert.equal(calls, 1);
  assert.deepEqual(harness.messages, []);
  assert.deepEqual(harness.errors, []);
});

await test('invalid prompted attachments neither rerun guards nor refund an occupied command cooldown', async (t) => {
  let allow = false,
    guardCalls = 0,
    handlerCalls = 0;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): GuardResult {
      guardCalls++;
      return allow;
    }
  }
  @Controller()
  class Commands {
    @Command('collect', { aliases: ['again'] })
    @UseGuards(Gate)
    @Cooldown({ scope: 'user', durationMs: 60000, message: 'cooldown' })
    async collect(@Ctx() ctx: MessageContext): Promise<void> {
      handlerCalls++;
      const answer = await ctx.prompt('send-file');
      assert.ok(answer.status === 'received');
      const result = selectAttachments(answer.message.attachments, {
        kind: 'file',
        minCount: 1,
        maxCount: 1,
      });
      assert.deepEqual(result, { status: 'invalid', reason: 'too-few', count: 0, limit: 1 });
      await answer.message.reply('invalid');
    }
  }
  @Module({ controllers: [Commands], providers: [Gate] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  let next = 0;
  const event = (content: string, attachments: unknown[] = []): QQDispatch => ({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: `cooldown-${++next}`,
      group_openid: 'group',
      author: { member_openid: 'user' },
      content,
      attachments,
    },
  });
  await harness.dispatch(event('/collect'));
  assert.equal(handlerCalls, 0);
  assert.equal(harness.messages.length, 0);
  allow = true;
  const start = harness.enqueue(event('/collect'));
  assert.ok('done' in start);
  await until(() => harness.messages.length === 1);
  const answer = harness.enqueue(
    event('', [{ url: 'https://example.invalid/image', content_type: 'image/png' }]),
  );
  assert.ok('done' in answer);
  await Promise.all([start.done, answer.done]);
  assert.equal(guardCalls, 2);
  assert.equal(handlerCalls, 1);
  await harness.dispatch(event('/again'));
  assert.equal(guardCalls, 3);
  assert.equal(handlerCalls, 1);
  assert.deepEqual(
    harness.messages.map((entry) => entry.payload.content),
    ['send-file', 'invalid', 'cooldown'],
  );
  assert.deepEqual(harness.errors, []);
  assert.equal(harness.app.snapshot().prompts.pending, 0);
});
