import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Args,
  Attachments,
  Audios,
  Command,
  Controller,
  Cooldown,
  Ctx,
  Files,
  FrameworkError,
  HelpModule,
  Images,
  Injectable,
  Module,
  On,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
  Videos,
} from '../src/index.js';
import type {
  Attachment,
  AttachmentOptions,
  CanActivate,
  GuardResult,
  MessageContext,
  QQDispatch,
  Type,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';

let next = 0;
function file(filename: string, contentType?: string, extra: Record<string, unknown> = {}) {
  return {
    url: `https://example.invalid/${filename}`,
    filename,
    ...(contentType === undefined ? {} : { content_type: contentType }),
    ...extra,
  };
}
function message(
  content: string,
  attachments: unknown = [],
  eventName = 'C2C_MESSAGE_CREATE',
  extra: Record<string, unknown> = {},
): QQDispatch {
  return {
    op: 0,
    t: eventName,
    d: {
      id: `attachments-${++next}`,
      content,
      ...(eventName === 'C2C_MESSAGE_CREATE'
        ? { author: { user_openid: 'user' } }
        : { group_openid: 'group', author: { member_openid: 'user' } }),
      ...(attachments === undefined ? {} : { attachments }),
      ...extra,
    },
  };
}
async function open(t: TestContext, root: Type, options: TestOptions = {}) {
  const harness = await createTestApplication(root, options);
  t.after(() => harness.app.close());
  await harness.app.start();
  return harness;
}
function configurationError(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === 'CONFIG';
}
const names = (files: readonly Attachment[]) => files.map((entry) => entry.filename);

await test('attachment selectors classify mixed top-level inputs in private, group and mentioned messages', async (t) => {
  @Controller()
  class Inspect {
    @Command('附件') inspect(
      @Attachments() all: readonly Attachment[],
      @Images() images: readonly Attachment[],
      @Videos() videos: readonly Attachment[],
      @Audios() audios: readonly Attachment[],
      @Files() files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      assert.equal(all.length, ctx.attachments.length);
      assert.equal(images[0]?.contentType, ' Image/JPEG ; charset=binary');
      assert.equal(images[0], all[0]);
      return JSON.stringify({
        all: names(all),
        images: names(images),
        videos: names(videos),
        audios: names(audios),
        files: names(files),
      });
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const duplicate = file('photo.jpg', ' Image/JPEG ; charset=binary');
  const inputs = [
    duplicate,
    duplicate,
    file('png', 'image/png'),
    file('gif', 'image/gif'),
    file('movie', ' Video/MP4; codecs=avc1'),
    file('speech', 'VOICE'),
    file('sound', 'audio/ogg'),
    file('download', ' File '),
    file('document', 'application/pdf'),
    file('archive', 'application/zip'),
    file('notes', 'text/plain; charset=utf-8'),
    file('vendor', 'application/vnd.example+json'),
    file('missing-type.png'),
    file('unknown.jpg', 'unknown'),
    file('bare.png', 'image'),
    file('bad', 'image/'),
    file('range', 'image/*'),
    file('too-many-slashes', 'image/png/extra'),
    file('space', 'image/p ng'),
  ];
  const expected = {
    all: inputs.map((entry) => entry.filename),
    images: ['photo.jpg', 'photo.jpg', 'png', 'gif'],
    videos: ['movie'],
    audios: ['speech', 'sound'],
    files: ['download', 'document', 'archive', 'notes', 'vendor'],
  };
  for (const prefix of ['/', '']) {
    const harness = await open(t, Root, { commands: { prefix } });
    for (const eventName of [
      'C2C_MESSAGE_CREATE',
      'GROUP_MESSAGE_CREATE',
      'GROUP_AT_MESSAGE_CREATE',
    ]) {
      await harness.dispatch(
        message(
          `${eventName === 'GROUP_AT_MESSAGE_CREATE' ? '<@self> ' : ''}${prefix}附件`,
          inputs,
          eventName,
          { mentions: [{ id: 'self', is_you: true }] },
        ),
      );
      const result: unknown = JSON.parse(harness.messages.at(-1)?.payload.content ?? 'null');
      assert.deepEqual(result, expected);
    }
    assert.deepEqual(harness.errors, []);
  }
});

await test('voice metadata is exposed without replacing content or inventing commands from ASR', async (t) => {
  let calls = 0;
  @Controller()
  class Inspect {
    @Command('voice') inspect(
      @Audios() audios: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      calls++;
      assert.equal(ctx.content, '/voice');
      assert.equal(audios[0]?.voiceWavUrl, 'https://example.invalid/voice.wav');
      assert.equal(audios[0]?.asrReferText, '/voice');
      assert.equal(audios[0]?.contentType, 'voice');
      assert.equal(audios[0]?.raw.voice_wav_url, audios[0]?.voiceWavUrl);
      assert.equal(audios[1]?.voiceWavUrl, undefined);
      assert.equal(audios[1]?.asrReferText, undefined);
      assert.equal(audios[1]?.raw.voice_wav_url, 123);
      return 'voice metadata retained';
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  const inputs = [
    file('voice.silk', 'voice', {
      voice_wav_url: 'https://example.invalid/voice.wav',
      asr_refer_text: '/voice',
    }),
    file('audio', 'audio/mpeg', { voice_wav_url: 123, asr_refer_text: false }),
  ];
  await harness.dispatch(message('/voice', inputs));
  assert.equal(await harness.dispatch(message('', inputs)), 'ignored');
  assert.equal(calls, 1);
  assert.equal(harness.messages.length, 1);
  assert.deepEqual(harness.errors, []);
});

await test('referenced and nested attachments and ARK previews are never selected as current attachments', async (t) => {
  @Controller()
  class Inspect {
    @Command('inspect') inspect(
      @Attachments() all: readonly Attachment[],
      @Images() images: readonly Attachment[],
    ): string {
      return JSON.stringify({ all: names(all), images: names(images) });
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  const referenced = {
    message_type: 103,
    msg_elements: [
      {
        attachments: [file('quoted', 'image/png')],
        msg_elements: [{ attachments: [file('nested', 'image/jpeg')] }],
      },
    ],
    ark_data: { ark_type: 'picture', fields: { preview: 'https://example.invalid/preview.png' } },
  };
  await harness.dispatch(message('/inspect', [], 'C2C_MESSAGE_CREATE', referenced));
  await harness.dispatch(
    message('/inspect', [file('current', 'image/png')], 'GROUP_MESSAGE_CREATE', referenced),
  );
  assert.deepEqual(
    harness.messages.map((entry) => JSON.parse(entry.payload.content ?? 'null') as unknown),
    [
      { all: [], images: [] },
      { all: ['current'], images: ['current'] },
    ],
  );
  assert.deepEqual(harness.errors, []);
});

await test('each attachment parameter receives an independent shallow-frozen ordered array', async (t) => {
  const snapshots: (readonly Attachment[])[] = [];
  @Controller()
  class Inspect {
    @Command('copies') inspect(
      @Images() first: readonly Attachment[],
      @Attachments() all: readonly Attachment[],
      @Images() second: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      for (const selected of [first, all, second]) {
        assert.ok(Object.isFrozen(selected));
        assert.notEqual(selected, ctx.attachments);
        assert.throws(() => (selected as Attachment[]).push({ url: 'unused', raw: {} }), TypeError);
      }
      assert.notEqual(first, second);
      assert.notEqual(first, all);
      if (first.length) {
        assert.equal(first[0], ctx.attachments[0]);
        assert.equal(first[0]?.raw, ctx.attachments[0]?.raw);
      }
      snapshots.push(first);
      return String(ctx.attachments.length);
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  await harness.dispatch(message('/copies', [file('image', 'image/png')]));
  await harness.dispatch(message('/copies'));
  assert.notEqual(snapshots[0], snapshots[1]);
  assert.equal(snapshots[0]?.length, 1);
  assert.equal(snapshots[1]?.length, 0);
  assert.deepEqual(harness.errors, []);
});

await test('attachment counts apply after filtering, including empty defaults and zero upper bounds', async (t) => {
  const calls: string[] = [];
  @Controller()
  class Inspect {
    @Command('images') images(
      @Images({ minCount: 1, maxCount: 2 }) images: readonly Attachment[],
    ): string {
      calls.push(`images:${images.length}`);
      return 'images accepted';
    }
    @Command('no-files') noFiles(@Files({ maxCount: 0 }) files: readonly Attachment[]): string {
      calls.push(`files:${files.length}`);
      return 'no files';
    }
    @Command('optional') optional(@Videos() videos: readonly Attachment[]): string {
      calls.push(`videos:${videos.length}`);
      return 'optional';
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root, { commands: { invalidInput: 'reply' } });
  await harness.dispatch(message('/images'));
  await harness.dispatch(message('/images', [file('pdf', 'application/pdf')]));
  await harness.dispatch(
    message('/images', [
      file('a', 'image/png'),
      file('b', 'file'),
      file('c', 'image/jpeg'),
      file('unknown'),
    ]),
  );
  await harness.dispatch(
    message('/images', [file('a', 'image/png'), file('b', 'image/png'), file('c', 'image/png')]),
  );
  await harness.dispatch(message('/no-files', [file('image', 'image/png')]));
  await harness.dispatch(message('/no-files', [file('file', 'file')]));
  await harness.dispatch(message('/optional'));
  await tick();
  assert.deepEqual(calls, ['images:2', 'files:0', 'videos:0']);
  assert.equal(harness.errors.length, 4);
  for (const { error, context } of harness.errors) {
    assert.ok(error instanceof FrameworkError && error.code === 'PARAMETER_PARSE');
    assert.equal(context.phase, 'command');
  }
  assert.match(harness.messages[0]?.payload.content ?? '', /图片数量不能少于 1/u);
  assert.match(harness.messages[3]?.payload.content ?? '', /图片数量不能超过 2/u);
  assert.match(harness.messages[5]?.payload.content ?? '', /文件数量不能超过 0/u);
});

await test('adding attachment options preserves legacy flags, excess words and JavaScript defaults', async (t) => {
  @Controller()
  class Inspect {
    @Command('legacy') legacy(
      @Images({ maxCount: 2 }) images: readonly Attachment[],
      @Arg(0) first = 'default',
      @Args() all: string[],
      @Arg(5) missing?: string,
    ): string {
      return JSON.stringify({ first, all, missing, images: images.length });
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  await harness.dispatch(message('/legacy --unknown 2 tail', [file('image', 'image/png')]));
  await harness.dispatch(message('/legacy'));
  assert.deepEqual(
    harness.messages.map((entry) => JSON.parse(entry.payload.content ?? 'null') as unknown),
    [
      { first: '--unknown', all: ['--unknown', '2', 'tail'], images: 1 },
      { first: 'default', all: [], images: 0 },
    ],
  );
  assert.deepEqual(harness.errors, []);
});

await test('structured text binding finishes before attachment validation regardless of declaration order', async (t) => {
  let calls = 0;
  @Controller()
  class Inspect {
    @Command('query') query(
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @Rest() rest: string[],
      @Slot('city', { choices: ['北京', '上海'], required: true }) city: string,
      @Arg(0, { name: '名称', required: true }) name: string,
      @Option('detail', { type: 'boolean', default: false }) detail: boolean,
    ): string {
      calls++;
      return JSON.stringify({ name, city, rest, detail, images: names(images) });
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root, { commands: { invalidInput: 'reply' } });
  for (const input of [
    '/query --unknown',
    '/query',
    '/query 名称 北京 上海',
    '/query 名称 北京 --detail=bad',
  ])
    await harness.dispatch(message(input));
  await harness.dispatch(message('/query 标签 明天 北京 --detail', [file('image', 'image/png')]));
  await tick();
  assert.equal(calls, 1);
  assert.equal(harness.errors.length, 4);
  for (const entry of harness.errors) assert.doesNotMatch(entry.error.message, /图片数量/u);
  const result: unknown = JSON.parse(harness.messages.at(-1)?.payload.content ?? 'null');
  assert.deepEqual(result, {
    name: '标签',
    city: '北京',
    rest: ['明天'],
    detail: true,
    images: ['image'],
  });
});

await test('Guard rejection precedes attachments and invalid counts do not occupy shared alias cooldown', async (t) => {
  let allow = false;
  let calls = 0;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): GuardResult {
      return allow || { allow: false, message: 'guard denied' };
    }
  }
  @Controller()
  class Inspect {
    @Command('guarded', { aliases: ['again'] })
    @UseGuards(Gate)
    @Cooldown({ scope: 'user', durationMs: 60000, message: 'cooldown' })
    inspect(@Images({ minCount: 1 }) images: readonly Attachment[]): string {
      calls++;
      return String(images.length);
    }
  }
  @Module({ controllers: [Inspect], providers: [Gate] })
  class Root {}
  const harness = await open(t, Root, { commands: { invalidInput: 'reply' } });
  await harness.dispatch(message('/guarded'));
  await tick();
  assert.equal(harness.errors.length, 0);
  assert.equal(harness.messages[0]?.payload.content, 'guard denied');
  allow = true;
  await harness.dispatch(message('/guarded'));
  await harness.dispatch(message('/guarded', [file('image', 'image/png')]));
  await harness.dispatch(message('/again', [file('image', 'image/png')]));
  await tick();
  assert.equal(calls, 1);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.messages[2]?.payload.content, '1');
  assert.equal(harness.messages[3]?.payload.content, 'cooldown');
});

await test('attachment validation respects report mode without sending an automatic hint', async (t) => {
  @Controller()
  class Inspect {
    @Command('required') inspect(
      @Attachments({ minCount: 1 }) _files: readonly Attachment[],
    ): void {
      void _files;
      assert.fail('Missing attachments must not reach the handler');
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  await harness.dispatch(message('/required'));
  await tick();
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.errors[0]?.context.phase, 'command');
});

await test('attachment help explains cardinality and options are snapshotted at declaration', async (t) => {
  const options: AttachmentOptions = {
    name: '素材',
    description: '测试照片',
    minCount: 1,
    maxCount: 4,
  };
  @Controller()
  class Inspect {
    @Command('pictures', { aliases: ['pic'] }) inspect(
      @Images(options) images: readonly Attachment[],
      @Attachments() all: readonly Attachment[],
      @Videos({ maxCount: 2 }) videos: readonly Attachment[],
      @Audios() audios: readonly Attachment[],
      @Files({ maxCount: 0 }) files: readonly Attachment[],
    ): void {
      void [images, all, videos, audios, files];
    }
  }
  options.name = 'changed';
  options.minCount = 9;
  @Module({ imports: [HelpModule], controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root, { commands: { invalidInput: 'reply' } });
  await harness.dispatch(message('/help pic'));
  const help = harness.messages[0]?.payload.content ?? '';
  assert.ok(help.startsWith('用法：/pictures <素材附件> [附件] [视频附件] [音频附件] [文件附件]'));
  for (const part of [
    '测试照片',
    '最少 1 个',
    '最多 4 个',
    '数量无上限',
    '同一条消息',
    '不占文字参数',
  ])
    assert.ok(help.includes(part));
  assert.doesNotMatch(help, /changed|最少 9/u);
  await harness.dispatch(message('/pictures'));
  assert.match(harness.messages[1]?.payload.content ?? '', /素材数量不能少于 1/u);
});

await test('invalid attachment configuration fails before constructing controllers', async () => {
  let constructed = 0;
  const invalid: unknown[] = [
    { minCount: -1 },
    { minCount: 1.5 },
    { minCount: NaN },
    { minCount: Infinity },
    { minCount: Number.MAX_SAFE_INTEGER + 1 },
    { minCount: '1' },
    { minCount: null },
    { maxCount: -1 },
    { maxCount: 1.5 },
    { maxCount: Infinity },
    { maxCount: NaN },
    { maxCount: Number.MAX_SAFE_INTEGER + 1 },
    { maxCount: '1' },
    { maxCount: null },
    { minCount: 2, maxCount: 1 },
    { required: true },
    { default: [] },
    { name: '' },
    { name: ' ' },
    { name: 'bad\nname' },
    { name: 1 },
    { description: false },
  ];
  for (const options of invalid) {
    @Controller()
    class Invalid {
      constructor() {
        constructed++;
      }
      @Command('invalid') inspect(
        @Images(options as AttachmentOptions) _images: readonly Attachment[],
      ): void {
        void _images;
      }
    }
    @Module({ controllers: [Invalid] })
    class Root {}
    await assert.rejects(createTestApplication(Root), configurationError);
  }
  assert.equal(constructed, 0);
  for (const factory of [Attachments, Images, Videos, Audios, Files]) {
    for (const options of [null, [], 'invalid'])
      assert.throws(() => factory(options as unknown as AttachmentOptions), configurationError);
    assert.throws(() => factory()(class Constructor {}, undefined, 0), configurationError);
    assert.throws(() => factory()(class StaticMethod {}, 'handler', 0), configurationError);
  }
});

await test('attachment parameters reject raw event/button handlers and duplicate bindings, while inheritance works', async (t) => {
  for (const factory of [Attachments, Images, Videos, Audios, Files]) {
    for (const route of [On('C2C_MESSAGE_CREATE'), OnButton('press')]) {
      @Controller()
      class Invalid {
        @route inspect(@factory() _attachments: readonly Attachment[]): void {
          void _attachments;
        }
      }
      @Module({ controllers: [Invalid] })
      class Root {}
      await assert.rejects(createTestApplication(Root), configurationError);
    }
  }
  assert.throws(() => {
    @Controller()
    class Duplicate {
      @Command('duplicate') inspect(
        @Images() @Attachments() _attachments: readonly Attachment[],
      ): void {
        void _attachments;
      }
    }
    void Duplicate;
  }, configurationError);
  @Controller()
  class Base {
    @Command('inherited') inspect(@Images({ minCount: 1 }) images: readonly Attachment[]): string {
      return String(images.length);
    }
  }
  @Controller()
  class Derived extends Base {}
  @Module({ controllers: [Derived] })
  class Root {}
  const harness = await open(t, Root);
  await harness.dispatch(message('/inherited', [file('one', 'image/png')]));
  assert.equal(harness.messages[0]?.payload.content, '1');
  assert.deepEqual(harness.errors, []);
});

await test('new selectors preserve existing malformed attachment and missing URL rejection', async (t) => {
  @Controller()
  class Inspect {
    @Command('inspect') inspect(@Attachments() _attachments: readonly Attachment[]): void {
      void _attachments;
      assert.fail('Invalid protocol input reached the handler');
    }
  }
  @Module({ controllers: [Inspect] })
  class Root {}
  const harness = await open(t, Root);
  for (const attachments of [
    'not-an-array',
    [{ content_type: 'image/png' }],
    [{ content_type: 'voice', voice_wav_url: 'https://example.invalid/audio.wav' }],
  ])
    assert.equal(await harness.dispatch(message('/inspect', attachments)), 'ignored');
  await tick();
  assert.equal(harness.errors.length, 3);
  for (const { error, context } of harness.errors) {
    assert.ok(error instanceof FrameworkError && error.code === 'PROTOCOL');
    assert.equal(context.phase, 'protocol');
  }
});
