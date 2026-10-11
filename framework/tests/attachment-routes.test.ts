import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Attachments,
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  Group,
  GroupId,
  GroupManagersOnly,
  Images,
  Injectable,
  Module,
  On,
  OnAttachment,
  OnButton,
  Role,
  User,
  UserId,
  UseGuards,
} from '../src/index.js';
import type {
  Attachment,
  CanActivate,
  GuardContext,
  GroupInfo,
  GroupRole,
  MessageContext,
  OnAttachmentOptions,
  QQDispatch,
  QQEventContext,
  Type,
  UserInfo,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';
import { until } from './helpers.js';
import { Application } from '../src/core/application.js';
import { FakeClock } from './fake-clock.js';

let next = 0;
const file = (filename?: string, content_type?: string) => ({
  url: 'https://example.invalid/upload.docx',
  ...(filename === undefined ? {} : { filename }),
  ...(content_type === undefined ? {} : { content_type }),
});
function message(
  attachments: unknown[] = [],
  content = '',
  group = false,
  role = 'member',
): QQDispatch {
  return {
    op: 0,
    t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `route-${++next}`,
      content,
      attachments,
      ...(group
        ? { group_openid: 'group', author: { member_openid: 'user', member_role: role } }
        : { author: { user_openid: 'user' } }),
    },
  };
}
async function open(t: TestContext, root: Type, options: TestOptions = {}) {
  const harness = await createTestApplication(root, options);
  t.after(() => harness.app.close());
  await harness.app.start();
  return harness;
}
const config = (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG';

await test('attachment filters AND on one item; parameters select matches while context retains all', async (t) => {
  const calls: string[][] = [];
  @Controller()
  class Routes {
    @OnAttachment({ filename: /^report_\d+\.docx$/i, extension: '.DOCX', kind: 'file' })
    inspect(
      @Attachments() files: readonly Attachment[],
      @Attachments() other: readonly Attachment[],
      @Images() images: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      assert.ok(Object.isFrozen(files));
      assert.ok(Object.isFrozen(other));
      assert.notEqual(files, other);
      assert.equal(files[0], other[0]);
      assert.equal(images.length, 0);
      assert.equal(ctx.attachments.length, 5);
      calls.push(files.map((item) => item.filename!));
      return 'matched';
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  const duplicate = file('REPORT_1.DOCX', ' Application/Vnd.Document; charset=binary');
  await h.dispatch(
    message([
      duplicate,
      duplicate,
      file('report_2.docx', 'image/png'),
      file('other.docx', 'file'),
      file(undefined, 'file'),
    ]),
  );
  assert.deepEqual(calls, [['REPORT_1.DOCX', 'REPORT_1.DOCX']]);
  assert.equal(
    await h.dispatch(message([file('report_2.docx', 'image/png'), file('other.docx', 'file')])),
    'ignored',
  );
  assert.equal(await h.dispatch(message([], 'text')), 'ignored');
  assert.equal(h.errors.length, 0);
});

await test('exact names are case sensitive; extension needs filename; kind reuses all five classifications', async (t) => {
  const hits: string[] = [];
  @Controller()
  class Routes {
    @OnAttachment() all() {
      hits.push('all');
    }
    @OnAttachment({ filename: 'Report.docx' }) exact() {
      hits.push('exact');
    }
    @OnAttachment({ extension: 'docx' }) extension() {
      hits.push('extension');
    }
    @OnAttachment({ kind: 'image' }) image() {
      hits.push('image');
    }
    @OnAttachment({ kind: 'video' }) video() {
      hits.push('video');
    }
    @OnAttachment({ kind: 'audio' }) audio() {
      hits.push('audio');
    }
    @OnAttachment({ kind: 'file' }) files() {
      hits.push('file');
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  const inputs: [unknown[], string[]][] = [
    [[file('Report.docx', 'file')], ['all', 'exact', 'extension', 'file']],
    [[file('report.DOCX')], ['all', 'extension']],
    [[file(undefined, 'image/jpeg')], ['all', 'image']],
    [[file('x', ' Video/MP4; codecs=abc')], ['all', 'video']],
    [[file('x', 'VOICE')], ['all', 'audio']],
    [[file('x', 'audio/ogg')], ['all', 'audio']],
    [[file('x', 'application/pdf')], ['all', 'file']],
    [[file('x', 'unknown')], ['all']],
  ];
  for (const [attachments, expected] of inputs) {
    hits.length = 0;
    await h.dispatch(message(attachments));
    assert.deepEqual([...hits].sort(), [...expected].sort());
  }
  assert.equal(h.errors.length, 0);
});

await test('regex source and flags are snapshotted and g/y state resets for each item and message', async (t) => {
  const expression = /^report\.docx$/gy;
  const options = { filename: expression, extension: 'docx' };
  const decorator = OnAttachment(options);
  options.extension = 'pdf';
  expression.lastIndex = 100;
  expression.compile('never', 'i');
  let count = 0;
  @Controller()
  class Routes {
    @decorator inspect(@Attachments() files: readonly Attachment[]) {
      count += files.length;
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('report.docx'), file('report.docx')]));
  await h.dispatch(message([file('report.docx')]));
  assert.equal(count, 3);
});

await test('routes use top-level normalized metadata and identity snapshots even after raw observers change payload', async (t) => {
  const seen: string[] = [];
  @Controller()
  class Routes {
    @On('C2C_MESSAGE_CREATE') observe(@Ctx() ctx: QQEventContext) {
      const data = ctx.raw.d as { author: unknown; attachments?: { filename?: string }[] };
      data.author = { user_openid: 'changed' };
      if (data.attachments?.[0]) data.attachments[0].filename = 'changed.pdf';
    }
    @OnAttachment({ extension: 'docx' }) inspect(
      @Attachments() files: readonly Attachment[],
      @User() user: UserInfo,
    ) {
      assert.equal(user.id, 'user');
      seen.push(files[0]!.filename!);
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('top.docx')]));
  const nested = message([]);
  Reflect.set(nested.d as object, 'referenced_message', { attachments: [file('quoted.docx')] });
  Reflect.set(nested.d as object, 'nested', { attachments: [file('nested.docx')] });
  await h.dispatch(nested);
  await h.dispatch(message([file(undefined)]));
  assert.deepEqual(seen, ['top.docx']);
  assert.equal(h.errors.length, 0);
});

await test('known commands own attachments even when parsing or execution fails; observers retain order', async (t) => {
  const calls: string[] = [];
  @Controller()
  class Routes {
    @On('C2C_MESSAGE_CREATE') observe() {
      calls.push('observe');
    }
    @Command('known') known(@Arg(0, { type: 'integer', required: true }) n: number) {
      calls.push('command');
      throw new Error(String(n));
    }
    @OnAttachment() automatic() {
      calls.push('attachment');
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('x')], '/known invalid'));
  await h.dispatch(message([file('x')], '/known 1'));
  await h.dispatch(message([file('x')], '/unknown'));
  assert.deepEqual(calls, ['observe', 'observe', 'command', 'observe', 'attachment']);
  assert.equal(h.errors.length, 2);
});

await test('broadcast isolates replies, hints and same-error attribution while sharing reply sequence', async (t) => {
  const failure = new Error('shared failure');
  @Injectable()
  class Denied implements CanActivate {
    canActivate() {
      return { allow: false as const, message: 'denied' };
    }
  }
  @Controller()
  class Routes {
    @OnAttachment() async aManual(@Ctx() ctx: MessageContext) {
      await ctx.reply('manual');
    }
    @OnAttachment() bAuto() {
      return 'auto';
    }
    @OnAttachment() @UseGuards(Denied) cDenied() {
      assert.fail('denied handler ran');
    }
    @OnAttachment() dError() {
      throw failure;
    }
    @OnAttachment() eError() {
      throw failure;
    }
    @OnAttachment() fAuto() {
      return 'last';
    }
  }
  @Module({ controllers: [Routes], providers: [Denied] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('x')]));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['manual', 'auto', 'denied', 'last'],
  );
  assert.deepEqual(
    h.messages.map((m) => m.payload.msg_seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    h.errors.map((e) => [e.context.phase, e.context.method]),
    [
      ['attachment', 'dError'],
      ['attachment', 'eError'],
    ],
  );
  assert.equal(h.app.snapshot().events.failed, 1);
});

await test('attachment cardinality feedback is per route, precedes cooldown and never shows command help', async (t) => {
  @Controller()
  class Routes {
    @OnAttachment({ kind: 'file', invalidInput: 'reply' })
    @Cooldown({ durationMs: 60000, scope: 'user', message: 'cooldown' })
    aReply(@Attachments({ minCount: 2, maxCount: 2 }) files: readonly Attachment[]) {
      return String(files.length);
    }
    @OnAttachment()
    bReport(@Images({ minCount: 1 }) images: readonly Attachment[]) {
      return String(images.length);
    }
    @OnAttachment() cAlways() {
      return 'always';
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root, { commands: { invalidInput: 'reply' } });
  await h.dispatch(message([file('a', 'file')]));
  assert.match(h.messages[0]!.payload.content!, /不能少于 2/u);
  assert.doesNotMatch(h.messages[0]!.payload.content!, /命令|用法/u);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    [h.messages[0]!.payload.content, 'always'],
  );
  await h.dispatch(message([file('a', 'file'), file('b', 'file')]));
  await h.dispatch(message([file('a', 'file'), file('b', 'file'), file('c', 'file')]));
  await h.dispatch(message([file('a', 'file'), file('b', 'file')]));
  assert.equal(h.messages.filter((m) => m.payload.content === '2').length, 1);
  assert.equal(h.messages.filter((m) => m.payload.content === 'cooldown').length, 1);
  assert.equal(h.errors.filter((e) => e.context.method === 'bReport').length, 4);
});

await test('group role guards precede binding; attachment guard receives frozen matches and identity agrees', async (t) => {
  const seen: GuardContext[] = [];
  @Injectable()
  class Gate implements CanActivate {
    canActivate(ctx: GuardContext) {
      assert.equal(ctx.kind, 'attachment');
      if (ctx.kind === 'attachment') {
        assert.ok(Object.isFrozen(ctx.matchedAttachments));
        assert.equal(ctx.matchedAttachments.length, 1);
        assert.equal(ctx.attachments.length, 2);
        assert.match(ctx.route, /^attachment:Routes\.inspect$/u);
      }
      seen.push(ctx);
      return true;
    }
  }
  @Controller()
  @UseGuards(Gate)
  class Routes {
    @OnAttachment({ extension: 'docx' })
    @GroupManagersOnly({ message: false })
    inspect(
      @User() user: UserInfo,
      @UserId() id: string,
      @Group() group: GroupInfo | undefined,
      @GroupId() groupId: string | undefined,
      @Role() role: GroupRole | undefined,
      @Attachments({ minCount: 1 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ) {
      assert.equal(user.id, id);
      assert.equal(id, ctx.userId);
      assert.ok(Object.isFrozen(user));
      assert.equal(group?.id, groupId);
      assert.equal(groupId, 'group');
      assert.ok(Object.isFrozen(group));
      assert.equal(role, ctx.scene === 'group' ? ctx.memberRole : undefined);
      assert.equal(files.length, 1);
      return role;
    }
  }
  @Module({ controllers: [Routes], providers: [Gate] })
  class Root {}
  const h = await open(t, Root);
  for (const role of ['owner', 'admin', 'member', 'unknown'])
    await h.dispatch(message([file('a.docx'), file('a.pdf')], '', true, role));
  await h.dispatch(message([file('a.docx'), file('a.pdf')]));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['owner', 'admin'],
  );
  assert.equal(seen.length, 5);
  assert.equal(h.errors.length, 0);
  assert.ok(seen.every((ctx) => ctx.signal.aborted));
});

await test('awaited prompt exclusively owns input, releases execution slot and delays remaining routes', async (t) => {
  const calls: string[] = [];
  let original: MessageContext | undefined;
  @Controller()
  class Routes {
    @OnAttachment({ extension: 'docx' }) async aPrompt(@Ctx() ctx: MessageContext) {
      original = ctx;
      calls.push('prompt');
      const result = await ctx.prompt('choose');
      assert.equal(result.status, 'received');
      if (result.status === 'received') {
        assert.equal(result.message.attachments[0]?.filename, 'answer.docx');
        await result.message.reply('answer');
      }
      calls.push('done');
    }
    @OnAttachment() bAfter(@Attachments() files: readonly Attachment[]) {
      calls.push(files[0]!.filename!);
      return 'after';
    }
    @Command('ping') ping() {
      calls.push('ping');
      return 'pong';
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root, { execution: { concurrency: 1 } });
  const upload = message([file('original.docx')]);
  const admission = h.enqueue(upload);
  assert.ok('done' in admission);
  await until(() => h.messages.length === 1 && h.app.snapshot().prompts.pending === 1);
  const ping = message([], '/ping');
  Reflect.set(ping.d as object, 'author', { user_openid: 'other' });
  await h.dispatch(ping);
  assert.deepEqual(calls, ['prompt', 'ping']);
  const answer = message([file('answer.docx')]);
  const input = h.enqueue(answer);
  assert.ok('done' in input);
  await admission.done;
  await input.done;
  assert.deepEqual(calls, ['prompt', 'ping', 'done', 'original.docx']);
  assert.equal(h.messages[2]!.payload.msg_id, (answer.d as { id: string }).id);
  assert.equal(h.messages[3]!.payload.msg_id, (upload.d as { id: string }).id);
  assert.equal(h.messages[3]!.payload.msg_seq, 2);
  assert.equal(await h.dispatch(answer), 'duplicate');
  assert.ok(original?.signal.aborted);
  assert.equal(h.errors.length, 0);
});

await test('unawaited prompt is cleared before the next handler; old context cannot act during it', async (t) => {
  let old: MessageContext | undefined;
  let lateError: unknown;
  @Controller()
  class Routes {
    @OnAttachment() aForget(@Ctx() ctx: MessageContext) {
      old = ctx;
      ctx.prompt('forgotten').catch(() => {});
    }
    @OnAttachment() async bNext(@Ctx() ctx: MessageContext) {
      assert.ok(old?.signal.aborted);
      try {
        await old.reply('late');
      } catch (error) {
        lateError = error;
      }
      const answer = await ctx.prompt('next');
      assert.equal(answer.status, 'cancelled');
      await ctx.reply('finished');
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root, { execution: { concurrency: 1 } });
  const admission = h.enqueue(message([file('x')]));
  assert.ok('done' in admission);
  await until(
    () =>
      h.messages.some((m) => m.payload.content === 'next') &&
      h.app.snapshot().prompts.pending === 1,
  );
  const cancel = h.enqueue(message([], '取消'));
  assert.ok('done' in cancel);
  await admission.done;
  await cancel.done;
  assert.ok(lateError instanceof FrameworkError);
  assert.equal(lateError.code, 'INVALID_STATE');
  assert.equal(h.app.snapshot().prompts.pending, 0);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['forgotten', 'next', 'finished'],
  );
  assert.ok(h.errors.every((e) => e.context.method === 'aForget'));
});

await test('unawaited framework sends drain before next handler and retain initiating error location', async (t) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const calls: string[] = [];
  @Controller()
  class Routes {
    @OnAttachment() aSend(@Ctx() ctx: MessageContext) {
      calls.push('first');
      ctx.reply('blocked').catch(() => {});
    }
    @OnAttachment() bNext() {
      calls.push('next');
      return 'next';
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root, {
    respond: (request) => {
      if ((request.body as { content?: string })?.content === 'blocked')
        return blocked.then(() => Response.json({ code: 1, message: 'failed' }, { status: 400 }));
      return undefined;
    },
  });
  const admission = h.enqueue(message([file('x')]));
  assert.ok('done' in admission);
  await until(() => calls.length === 1);
  await tick();
  assert.deepEqual(calls, ['first']);
  release();
  await admission.done;
  assert.deepEqual(calls, ['first', 'next']);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0]!.context.method, 'aSend');
  assert.equal(h.errors[0]!.context.phase, 'send');
});

await test('context operation budget is shared across attachment invocations', async (t) => {
  @Controller()
  class Routes {
    @OnAttachment() async a(@Ctx() ctx: MessageContext) {
      await ctx.reply('first');
    }
    @OnAttachment() async b(@Ctx() ctx: MessageContext) {
      await ctx.reply('second');
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root, { execution: { maxContextOperations: 1 } });
  await h.dispatch(message([file('x')]));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['first'],
  );
  assert.equal(h.errors.length, 1);
  assert.equal((h.errors[0]!.error as FrameworkError).code, 'RESOURCE_LIMIT');
  assert.equal(h.errors[0]!.context.method, 'b');
});

await test('attachment declarations validate before providers are constructed', async () => {
  let constructed = 0;
  const invalid: unknown[] = [
    { filename: '' },
    { filename: 1 },
    { extension: '' },
    { extension: '.' },
    { extension: 'tar.gz' },
    { extension: 'a/b' },
    { extension: '*.docx' },
    { extension: ' docx' },
    { kind: 'unknown' },
    { kind: 2 },
    { invalidInput: 'unknown' },
    { aliases: ['x'] },
  ];
  for (const options of invalid) {
    @Controller()
    class Routes {
      constructor() {
        constructed++;
      }
      @OnAttachment(options as OnAttachmentOptions) inspect() {}
    }
    @Module({ controllers: [Routes] })
    class Root {}
    await assert.rejects(createTestApplication(Root), config);
  }
  assert.equal(constructed, 0);
  assert.throws(() => OnAttachment(null as unknown as OnAttachmentOptions), config);
});

await test('attachment parameter placement, counts, duplicate bindings and route conflicts are rejected', async () => {
  @Controller()
  class Text {
    @OnAttachment() inspect(@Arg(0) value: string) {
      void value;
    }
  }
  @Controller()
  class Bare {
    inspect(@Attachments() value: readonly Attachment[]) {
      void value;
    }
  }
  @Controller()
  class Observer {
    @On('C2C_MESSAGE_CREATE') inspect(@Attachments() value: readonly Attachment[]) {
      void value;
    }
  }
  @Controller()
  class Button {
    @OnButton('x') inspect(@Attachments() value: readonly Attachment[]) {
      void value;
    }
  }
  @Controller()
  class Counts {
    @OnAttachment() inspect(
      @Attachments({ minCount: 2, maxCount: 1 }) value: readonly Attachment[],
    ) {
      void value;
    }
  }
  for (const controller of [Text, Bare, Observer, Button, Counts]) {
    @Module({ controllers: [controller] })
    class Root {}
    await assert.rejects(createTestApplication(Root), config);
  }
  assert.throws(
    () => {
      class Duplicate {
        @OnAttachment() @Command('x') inspect() {}
      }
      return Duplicate;
    },
    (error: unknown) => error instanceof FrameworkError && error.code === 'ROUTE_CONFLICT',
  );
  assert.throws(() => {
    class Duplicate {
      @OnAttachment() inspect(@Attachments() @Images() value: readonly Attachment[]) {
        void value;
      }
    }
    return Duplicate;
  }, config);
  assert.throws(() => {
    class Static {
      @OnAttachment() static inspect() {}
    }
    return Static;
  }, config);
});

await test('module discovery and inherited method overrides preserve existing stable route order', async (t) => {
  const calls: string[] = [];
  @Controller()
  class Base {
    @OnAttachment() a() {
      calls.push('base-a');
    }
    @OnAttachment() z() {
      calls.push('base-z');
    }
  }
  @Controller()
  class Child extends Base {
    override a() {
      calls.push('hidden');
    }
    @OnAttachment() b() {
      calls.push('child-b');
    }
  }
  @Controller()
  class First {
    @OnAttachment() inspect() {
      calls.push('import');
    }
  }
  @Module({ controllers: [First] })
  class Imported {}
  @Module({ imports: [Imported], controllers: [Child] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('x')]));
  assert.deepEqual(calls, ['import', 'child-b', 'base-z']);
});

await test('manual reply plus return fails only its own handler; denied guards skip attachment validation', async (t) => {
  @Controller()
  class Routes {
    @OnAttachment() async aDouble(@Ctx() ctx: MessageContext) {
      await ctx.reply('manual');
      return 'duplicate';
    }
    @OnAttachment()
    @GroupManagersOnly({ message: false })
    bDenied(@Images({ minCount: 5 }) images: readonly Attachment[]) {
      return String(images.length);
    }
    @OnAttachment() cAuto() {
      return 'auto';
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('x')], '', true));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['manual', 'auto'],
  );
  assert.equal(h.errors.length, 1);
  assert.equal((h.errors[0]!.error as FrameworkError).code, 'HANDLER_CONTRACT');
  assert.equal(h.errors[0]!.context.method, 'aDouble');
});

await test('command guard rejection and cooldown never fall through to attachment routing', async (t) => {
  let automatic = 0;
  @Controller()
  class Routes {
    @Command('guarded') @GroupManagersOnly({ message: false }) guarded() {
      assert.fail('rejected');
    }
    @Command('limited') @Cooldown({ scope: 'user', durationMs: 60000, message: false }) limited() {
      return 'command';
    }
    @OnAttachment() inspect() {
      automatic++;
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message([file('x')], '/guarded'));
  await h.dispatch(message([file('x')], '/limited'));
  await h.dispatch(message([file('x')], '/limited'));
  assert.equal(automatic, 0);
  assert.equal(h.messages.length, 1);
  assert.equal(h.errors.length, 0);
});

async function timed(root: Type) {
  const clock = new FakeClock();
  const replies: string[] = [];
  const errors: Error[] = [];
  const app = await Application.create(
    root,
    {
      appId: 'timed',
      secret: 'offline-only',
      transport: { type: 'ws' },
      execution: { concurrency: 1, shutdownTimeoutMs: 20 },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError: (error) => {
        errors.push(error);
      },
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: (input, init) => {
        const path = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        ).pathname;
        if (path === '/app/getAppAccessToken')
          return Promise.resolve(Response.json({ access_token: 'offline', expires_in: 7200 }));
        assert.ok(path.endsWith('/messages'));
        const body = JSON.parse(init?.body as string) as { content: string };
        replies.push(body.content);
        return Promise.resolve(Response.json({ id: `timed-${replies.length}` }));
      },
    },
  );
  await app.start();
  return {
    app,
    clock,
    replies,
    errors,
    enqueue: (event: QQDispatch) =>
      app.execution.accept(event, Buffer.byteLength(JSON.stringify(event))),
  };
}

await test('attachment prompts isolate conversations and timeout before later handlers run', async () => {
  const results: string[] = [];
  @Controller()
  class Routes {
    @OnAttachment({ extension: 'docx' }) async a(@Ctx() ctx: MessageContext) {
      const answer = await ctx.prompt('question', { timeoutMs: 10 });
      results.push(`${ctx.scene}:${answer.status}`);
    }
    @OnAttachment({ extension: 'docx' }) b(@Ctx() ctx: MessageContext) {
      results.push(`${ctx.scene}:after`);
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const f = await timed(Root);
  try {
    const first = f.enqueue(message([file('a.docx')]));
    assert.ok('done' in first);
    await f.clock.flush();
    const second = f.enqueue(message([file('a.docx')], '', true));
    assert.ok('done' in second);
    await f.clock.flush();
    assert.equal(f.app.snapshot().prompts.pending, 2);
    const foreign = message([], 'ignored');
    Reflect.set(foreign.d as object, 'author', { user_openid: 'other' });
    assert.equal(f.enqueue(foreign).status, 'ignored');
    const cancel = f.enqueue(message([], '取消', true));
    assert.ok('done' in cancel);
    await f.clock.flush();
    assert.deepEqual(results, ['group:cancelled', 'group:after']);
    await f.clock.advance(10);
    await first.done;
    await second.done;
    await cancel.done;
    assert.deepEqual(results, [
      'group:cancelled',
      'group:after',
      'private:timeout',
      'private:after',
    ]);
    assert.equal(f.app.execution.managedSignals.size, 0);
    assert.deepEqual(f.app.snapshot().queue, { active: 0, pending: 0, retainedBytes: 0 });
    assert.equal(f.errors.length, 0);
  } finally {
    await f.app.close();
  }
});

await test('shutdown aborts suspended attachment prompt and removes invocation signals', async () => {
  let signal: AbortSignal | undefined;
  let later = false;
  @Controller()
  class Routes {
    @OnAttachment() async a(@Ctx() ctx: MessageContext) {
      signal = ctx.signal;
      await ctx.prompt('question');
    }
    @OnAttachment() b() {
      later = true;
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const f = await timed(Root);
  const admission = f.enqueue(message([file('x')]));
  assert.ok('done' in admission);
  await f.clock.flush();
  assert.equal(f.app.snapshot().prompts.pending, 1);
  await f.app.close();
  await admission.done;
  assert.ok(signal?.aborted);
  assert.equal(later, false);
  assert.equal(f.app.execution.managedSignals.size, 0);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  assert.deepEqual(f.app.snapshot().queue, { active: 0, pending: 0, retainedBytes: 0 });
});

await test('forced shutdown invalidates attachment contexts even when business code never resolves', async () => {
  let saved: MessageContext | undefined;
  let later = false;
  @Controller()
  class Routes {
    @OnAttachment() async a(@Ctx() ctx: MessageContext) {
      saved = ctx;
      await new Promise<void>(() => {});
    }
    @OnAttachment() b() {
      later = true;
    }
  }
  @Module({ controllers: [Routes] })
  class Root {}
  const f = await timed(Root);
  const admission = f.enqueue(message([file('x')]));
  assert.ok('done' in admission);
  await f.clock.flush();
  assert.ok(saved);
  const close = f.app.close();
  const observed = close.catch((error: unknown) => error);
  await f.clock.advance(20);
  assert.ok((await observed) instanceof FrameworkError);
  await admission.done;
  assert.ok(saved.signal.aborted);
  assert.equal(later, false);
  assert.equal(f.app.execution.managedSignals.size, 0);
  await assert.rejects(
    saved.reply('late'),
    (error: unknown) => error instanceof FrameworkError && error.code === 'INVALID_STATE',
  );
  assert.equal(f.replies.length, 0);
});
