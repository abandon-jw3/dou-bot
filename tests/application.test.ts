import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Command,
  Controller,
  Ctx,
  Injectable,
  Module,
  On,
  OnButton,
  QQClient,
  FrameworkError,
  image,
  markdown,
  keyboard,
  button,
} from '../src/index.js';
import type { ButtonContext, MessageContext, QQDispatch } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { Application } from '../src/core/application.js';

function privateMessage(id: string, content: string, user = 'u', index?: string): QQDispatch {
  return {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id,
      author: { user_openid: user },
      content,
      ...(index === undefined ? {} : { message_scene: { ext: [`msg_idx=${index}`] } }),
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

await test('one application runs decorated private and group commands through real DI and message encoding', async () => {
  const lifecycle: string[] = [];
  @Injectable()
  class Greetings {
    onModuleInit(): void {
      lifecycle.push('init');
    }
    onModuleDestroy(): void {
      lifecycle.push('destroy');
    }
    hello(name: string): string {
      return `Hello ${name}`;
    }
  }
  @Controller()
  class Commands {
    constructor(
      readonly service: Greetings,
      readonly client: QQClient,
    ) {}
    @Command('hello', { aliases: ['hi'] }) hello(@Arg(0) name = 'world'): string {
      return this.service.hello(name);
    }
  }
  @Module({ providers: [Greetings], controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  assert.equal(harness.app.status, 'created');
  await Promise.all([harness.app.start(), harness.app.start()]);
  try {
    assert.equal(harness.app.get(Commands).client, harness.app.client);
    await harness.dispatch(privateMessage('a', '/hello "Ada Lovelace"'));
    await harness.dispatch({
      op: 0,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: { id: 'b', group_id: 'g', author: { id: 'member' }, content: ' /hi' },
    });
    assert.deepEqual(
      harness.messages.map((message) => [
        message.target.scene,
        message.payload.content,
        message.payload.msg_seq,
      ]),
      [
        ['private', 'Hello Ada Lovelace', 1],
        ['group', 'Hello world', 1],
      ],
    );
    assert.equal(harness.errors.length, 0);
    assert.equal(harness.app.snapshot().events.accepted, 2);
  } finally {
    await harness.app.close();
  }
  assert.deepEqual(lifecycle, ['init', 'destroy']);
  await assert.rejects(harness.app.start(), /cannot be restarted/);
});

await test('custom and empty prefixes route group, private, and mentioned commands with exact names and aliases', async () => {
  @Controller()
  class Commands {
    @Command('hello', { aliases: ['hi', '问候'] }) hello(@Arg(0) name = 'world'): string {
      return `Hello ${name}`;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  for (const prefix of ['/', '!', 'bot:', '']) {
    const harness = await createTestApplication(Root, { commands: { prefix } });
    await harness.app.start();
    try {
      const group = (id: string, content: string, mentioned = false): QQDispatch => ({
        op: 0,
        t: 'GROUP_MESSAGE_CREATE',
        d: {
          id,
          group_openid: 'group',
          author: { member_openid: 'member' },
          content,
          ...(mentioned ? { mentions: [{ id: 'self', is_you: true }] } : {}),
        },
      });
      assert.equal(
        await harness.dispatch(privateMessage('private', `${prefix}hello "Ada Lovelace"`)),
        'accepted',
      );
      assert.equal(await harness.dispatch(group('group', `  ${prefix}hi`)), 'accepted');
      assert.equal(
        await harness.dispatch(group('mentioned', `<@self> ${prefix}问候 ""`, true)),
        'accepted',
      );
      const invalid = [
        `${prefix}helloThere`,
        `${prefix}HELLO`,
        `say ${prefix}hello`,
        `${prefix}unknown "unfinished`,
        '',
        '   ',
        `${prefix}hell`,
        prefix === '' ? '/hello' : 'hello',
      ];
      for (const [index, content] of invalid.entries()) {
        assert.equal(harness.enqueue(group(`ignored-group-${index}`, content)).status, 'ignored');
        assert.equal(
          harness.enqueue(privateMessage(`ignored-private-${index}`, content)).status,
          'ignored',
        );
      }
      assert.deepEqual(
        harness.messages.map((message) => [message.target.scene, message.payload.content]),
        [
          ['private', 'Hello Ada Lovelace'],
          ['group', 'Hello world'],
          ['group', 'Hello '],
        ],
      );
      assert.equal(harness.errors.length, 0);
      assert.equal(harness.app.snapshot().events.accepted, 3);
    } finally {
      await harness.app.close();
    }
  }
});

await test('full group messages route commands without a mention and ignore ordinary conversation', async () => {
  @Controller()
  class Commands {
    @Command('ping') ping(): string {
      return 'pong';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    const event = (id: string, content: string): QQDispatch => ({
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: { id, group_openid: 'group', author: { member_openid: 'member' }, content },
    });
    assert.equal(harness.enqueue(event('plain-command', '  /ping')).status, 'accepted');
    for (const [index, content] of ['hello', 'ping', '/unknown', 'I typed /ping'].entries()) {
      assert.equal(harness.enqueue(event(`ordinary-${index}`, content)).status, 'ignored');
    }
    await harness.flush();
    assert.equal(harness.messages.length, 1);
    assert.deepEqual(harness.messages[0]?.target, { scene: 'group', groupId: 'group' });
    assert.equal(harness.messages[0]?.payload.content, 'pong');
    assert.equal(harness.messages[0]?.payload.msg_id, 'plain-command');
    assert.equal(harness.messages[0]?.payload.msg_seq, 1);
    assert.equal(harness.errors.length, 0);
  } finally {
    await harness.app.close();
  }
});

await test('group commands route through self mentions without intercepting mentions to others', async () => {
  const contents: string[] = [];
  @Controller()
  class Commands {
    @Command('echo') echo(@Arg(0) value: string, @Ctx() context: MessageContext): string {
      contents.push(context.content);
      return value;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    for (const [index, type] of ['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE'].entries()) {
      await harness.dispatch({
        op: 0,
        t: type,
        d: {
          id: `self-${index}`,
          group_openid: 'group',
          author: { member_openid: 'member' },
          content: '<@self> /echo "Ada Lovelace"',
          mentions: [{ id: 'self', is_you: true }],
        },
      });
      assert.equal(
        harness.enqueue({
          op: 0,
          t: type,
          d: {
            id: `other-${index}`,
            group_openid: 'group',
            author: { member_openid: 'member' },
            content: '<@other> /echo wrong',
            mentions: [{ id: 'other', bot: true, is_you: false }],
          },
        }).status,
        'ignored',
      );
    }
    assert.deepEqual(contents, ['/echo "Ada Lovelace"', '/echo "Ada Lovelace"']);
    assert.deepEqual(
      harness.messages.map((message) => [message.target.scene, message.payload.content]),
      [
        ['group', 'Ada Lovelace'],
        ['group', 'Ada Lovelace'],
      ],
    );
    assert.equal(harness.errors.length, 0);
  } finally {
    await harness.app.close();
  }
});

await test('simultaneous duplicate deliveries execute once and share a completion', async () => {
  const release = deferred<void>();
  let calls = 0;
  @Controller()
  class Commands {
    @Command('wait') async wait(): Promise<string> {
      calls++;
      await release.promise;
      return 'done';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    const event = privateMessage('same', '/wait');
    const first = harness.enqueue(event);
    const duplicate = harness.enqueue(event);
    assert.equal(first.status, 'accepted');
    assert.equal(duplicate.status, 'duplicate');
    await tick();
    assert.equal(calls, 1);
    release.resolve();
    await harness.flush();
    assert.equal(harness.messages.length, 1);
    assert.equal(harness.app.snapshot().events.duplicates, 1);
  } finally {
    release.resolve();
    await harness.app.close();
  }
});

await test('different message indices share parent reply sequence while contexts remain isolated', async () => {
  @Controller()
  class Commands {
    @Command('who') async who(@Arg(0) name: string, @Ctx() ctx: MessageContext): Promise<string> {
      await tick();
      return `${ctx.userId}:${name}`;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    await Promise.all([
      harness.dispatch(privateMessage('parent', '/who one', 'u', '1')),
      harness.dispatch(privateMessage('parent', '/who two', 'u', '2')),
      harness.dispatch(privateMessage('parent', '/who other', 'other', '1')),
    ]);
    const shared = harness.messages.filter(
      (item) => item.target.scene === 'private' && item.target.userId === 'u',
    );
    assert.deepEqual(
      shared.map((item) => [item.payload.content, item.payload.msg_seq]),
      [
        ['u:one', 1],
        ['u:two', 2],
      ],
    );
    assert.equal(
      harness.messages.find((item) => item.payload.content === 'other:other')?.payload.msg_seq,
      1,
    );
  } finally {
    await harness.app.close();
  }
});

await test('unawaited framework sends are tracked until completion and late context reuse fails', async () => {
  const release = deferred<void>();
  let saved!: MessageContext;
  let sent = false;
  @Controller()
  class Commands {
    @Command('send') send(@Ctx() ctx: MessageContext): void {
      saved = ctx;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- Deliberately test tracking when user code omits await.
      ctx.reply('tracked');
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.endsWith('/messages')
        ? release.promise.then(() => {
            sent = true;
            return Response.json({ id: 'tracked-result' });
          })
        : undefined,
  });
  await harness.app.start();
  try {
    let completed = false;
    const running = harness.dispatch(privateMessage('m', '/send')).then(() => {
      completed = true;
    });
    await tick();
    assert.equal(completed, false);
    release.resolve();
    await running;
    assert.equal(sent, true);
    assert.equal(saved.signal.aborted, true);
    await assert.rejects(saved.reply('late'), /finished/);
  } finally {
    release.resolve();
    await harness.app.close();
  }
});

await test('manual plus automatic replies are rejected without sending twice', async () => {
  @Controller()
  class Commands {
    @Command('double') async double(@Ctx() ctx: MessageContext): Promise<string> {
      await ctx.reply('first');
      return 'second';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    await harness.dispatch(privateMessage('m', '/double'));
    assert.equal(harness.messages.length, 1);
    assert.ok(
      harness.errors.some(
        ({ error }) => error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT',
      ),
    );
  } finally {
    await harness.app.close();
  }
});

await test('observer failure does not stop a command and unknown commands do not trigger argument errors', async () => {
  @Controller()
  class Commands {
    @On('C2C_MESSAGE_CREATE') observe(): void {
      throw new Error('observer fixture');
    }
    @Command('ok') ok(): string {
      return 'ok';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    await harness.dispatch(privateMessage('m', '/ok'));
    assert.equal(harness.messages[0]?.payload.content, 'ok');
    await harness.dispatch(privateMessage('unknown', '/unknown "'));
    assert.equal(harness.messages.length, 1);
    assert.equal(harness.errors.filter((item) => item.context.phase === 'command').length, 0);
  } finally {
    await harness.app.close();
  }
});

await test('button acknowledgement is separate from a message reply and deduplicates manual ack', async () => {
  const choices: string[] = [];
  @Controller()
  class Commands {
    @OnButton('choose') async choose(@Ctx() ctx: ButtonContext): Promise<void> {
      choices.push(ctx.data);
      await ctx.ack();
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    const event: QQDispatch = {
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'interaction',
        chat_type: 1,
        group_openid: 'g',
        group_member_openid: 'member',
        data: { resolved: { button_id: 'choose', button_data: 'red' } },
      },
    };
    await harness.dispatch(event);
    await harness.dispatch(event);
    assert.deepEqual(choices, ['red']);
    assert.deepEqual(harness.acknowledgments, [{ interactionId: 'interaction', code: 0 }]);
    assert.equal(harness.messages.length, 0);
  } finally {
    await harness.app.close();
  }
});

await test('image uploads and Markdown keyboards use QQ wire payloads', async () => {
  @Controller()
  class Commands {
    @Command('image') image() {
      return image(new Uint8Array([1, 2, 3]));
    }
    @Command('menu') menu() {
      return markdown('**Choose**', {
        keyboard: keyboard([[button.callback('choice', 'Choose', 'a')]]),
      });
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  await harness.app.start();
  try {
    await harness.dispatch(privateMessage('m1', '/image'));
    await harness.dispatch(privateMessage('m2', '/menu'));
    const media = harness.messages[0]?.payload;
    assert.ok(media?.msg_type === 7);
    assert.equal(media.media.file_info, 'offline-file-info');
    const menu = harness.messages[1]?.payload;
    assert.ok(menu?.msg_type === 2);
    assert.equal(menu.markdown.content, '**Choose**');
    assert.equal(menu.keyboard?.content?.rows[0]?.buttons[0]?.id, 'choice');
  } finally {
    await harness.app.close();
  }
});

await test('queue overload rolls back admission and the same event can be retried', async () => {
  const release = deferred<void>();
  @Controller()
  class Commands {
    @Command('wait') async wait(): Promise<string> {
      await release.promise;
      return 'ok';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root, {
    execution: { concurrency: 1, queueCapacity: 1 },
  });
  await harness.app.start();
  try {
    assert.equal(harness.enqueue(privateMessage('a', '/wait')).status, 'accepted');
    assert.equal(harness.enqueue(privateMessage('b', '/wait')).status, 'accepted');
    assert.equal(harness.enqueue(privateMessage('c', '/wait')).status, 'overloaded');
    release.resolve();
    await harness.flush();
    assert.equal(await harness.dispatch(privateMessage('c', '/wait')), 'accepted');
    assert.equal(harness.messages.length, 3);
    assert.equal(harness.app.snapshot().queue.retainedBytes, 0);
  } finally {
    release.resolve();
    await harness.app.close();
  }
});

await test('close during initialization cancels startup without opening a transport', async () => {
  let destroyed = false;
  let requests = 0;
  @Injectable()
  class Slow {
    onModuleInit(signal: AbortSignal): Promise<void> {
      return new Promise((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    }
    onModuleDestroy(): void {
      destroyed = true;
    }
  }
  @Module({ providers: [Slow] })
  class Root {}
  const harness = await createTestApplication(Root, {
    respond: () => {
      requests++;
      return undefined;
    },
  });
  const starting = harness.app.start();
  starting.catch(() => {});
  await tick();
  await harness.app.close();
  await assert.rejects(starting, /stopped during startup/);
  assert.equal(harness.app.status, 'stopped');
  assert.equal(destroyed, true);
  assert.equal(requests, 0);
});

await test('shutdown deadline aborts a stuck handler and releases SDK queue reservations', async () => {
  const began = deferred<void>();
  let context!: MessageContext;
  @Controller()
  class Commands {
    @Command('forever') forever(@Ctx() ctx: MessageContext): Promise<void> {
      context = ctx;
      began.resolve();
      return new Promise(() => {});
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root, { execution: { shutdownTimeoutMs: 30 } });
  await harness.app.start();
  harness.enqueue(privateMessage('m', '/forever'));
  await began.promise;
  await assert.rejects(
    harness.app.close(),
    (error: unknown) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
  );
  assert.equal(context.signal.aborted, true);
  assert.deepEqual(harness.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
  assert.equal(harness.app.status, 'stopped');
});

await test('a failed async factory rolls back earlier owned resources without destroying external values', async () => {
  const calls: string[] = [];
  const external = {
    onModuleDestroy() {
      calls.push('external');
    },
  };
  @Module({
    providers: [
      { provide: 'external', useValue: external },
      {
        provide: 'resource',
        useFactory: async () => {
          await Promise.resolve();
          return {
            onModuleDestroy() {
              calls.push('resource');
            },
          };
        },
      },
      {
        provide: 'failure',
        inject: ['resource'],
        useFactory: () => {
          throw new Error('factory failed');
        },
      },
    ],
  })
  class Root {}
  await assert.rejects(createTestApplication(Root), /factory failed/);
  assert.deepEqual(calls, ['resource']);
});

await test('an init hook failure prevents network startup and destroys resources in reverse order', async () => {
  const calls: string[] = [];
  let requests = 0;
  @Injectable()
  class First {
    onModuleInit(): void {
      calls.push('first init');
    }
    onModuleDestroy(): void {
      calls.push('first destroy');
    }
  }
  @Injectable()
  class Second {
    onModuleInit(): void {
      calls.push('second init');
      throw new Error('init failed');
    }
    onModuleDestroy(): void {
      calls.push('second destroy');
    }
  }
  @Module({ providers: [First, Second] })
  class Root {}
  const bot = await createTestApplication(Root, {
    respond: () => {
      requests++;
      return undefined;
    },
  });
  await assert.rejects(bot.app.start(), /init failed/);
  assert.equal(bot.app.status, 'failed');
  assert.equal(requests, 0);
  assert.deepEqual(calls, ['first init', 'second init', 'second destroy', 'first destroy']);
  await bot.app.close();
});

await test('a failed automatic interaction acknowledgment still executes the button handler', async () => {
  @Controller()
  class Buttons {
    @OnButton('press') async pressed(@Ctx() context: ButtonContext): Promise<void> {
      await context.send('handled despite acknowledgment failure');
    }
  }
  @Module({ controllers: [Buttons] })
  class Root {}
  const bot = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.startsWith('/interactions/')
        ? Response.json({ code: 11253, message: 'fixture permission denial' })
        : undefined,
  });
  await bot.app.start();
  try {
    await bot.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'interaction',
        chat_type: 2,
        user_openid: 'user',
        data: { resolved: { button_id: 'press' } },
      },
    });
    assert.equal(bot.messages[0]?.payload.content, 'handled despite acknowledgment failure');
    assert.equal(bot.messages[0]?.payload.msg_id, undefined);
    assert.ok(bot.errors.some((entry) => entry.context.phase === 'interaction-ack'));
    assert.equal(bot.app.snapshot().events.failed, 1);
  } finally {
    await bot.app.close();
  }
});

await test('automatic confirmation capacity rejects and later readmits an event without leaving reservations', async () => {
  @Module({})
  class Root {}
  const response = deferred<Response>();
  let confirmations = 0;
  const bot = await createTestApplication(Root, {
    execution: { concurrency: 1, queueCapacity: 1 },
    respond: (request) =>
      request.url.pathname.startsWith('/interactions/') && ++confirmations === 1
        ? response.promise
        : undefined,
  });
  const interaction = (id: string): QQDispatch => ({
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id,
      chat_type: 2,
      user_openid: 'user',
      data: { resolved: { button_id: 'unhandled' } },
    },
  });
  await bot.app.start();
  try {
    const first = bot.enqueue(interaction('one'));
    assert.equal(first.status, 'accepted');
    assert.equal(bot.enqueue(interaction('two')).status, 'overloaded');
    response.resolve(new Response(null, { status: 204 }));
    await bot.flush();
    assert.equal(bot.enqueue(interaction('two')).status, 'accepted');
    await bot.flush();
    assert.equal(confirmations, 2);
    assert.deepEqual(bot.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
  } finally {
    response.resolve(new Response(null, { status: 204 }));
    await bot.app.close();
  }
});

await test('context operation limits stop extra requests before allocating reply sequences', async () => {
  @Controller()
  class Commands {
    @Command('many') many(@Ctx() context: MessageContext): void {
      for (let i = 0; i < 8; i++) context.reply(`reply-${i}`).catch(() => {});
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const bot = await createTestApplication(Root, { execution: { maxContextOperations: 2 } });
  await bot.app.start();
  try {
    await bot.dispatch(privateMessage('limited', '/many'));
    assert.deepEqual(
      bot.messages.map((message) => message.payload.msg_seq),
      [1, 2],
    );
    assert.equal(
      bot.errors.filter(
        (entry) => entry.error instanceof FrameworkError && entry.error.code === 'RESOURCE_LIMIT',
      ).length,
      6,
    );
    assert.deepEqual(bot.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
  } finally {
    await bot.app.close();
  }
});

await test('start remains single-flight when an init hook calls start again synchronously', async () => {
  let initializations = 0;
  let starts = 0;
  let nested: Promise<void> | undefined;
  @Injectable()
  class Resource {
    onModuleInit(): void {
      initializations++;
      if (initializations === 1) {
        nested = app.start();
        nested.catch(() => {});
      }
    }
  }
  @Module({ providers: [Resource] })
  class Root {}
  const app: Application = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret: 'fixture-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    {
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({
        start: () => {
          starts++;
          return Promise.resolve();
        },
        stop: () => Promise.resolve(),
      }),
    },
  );
  try {
    const first = app.start();
    await first;
    await nested;
    assert.equal(nested, first);
    assert.equal(initializations, 1);
    assert.equal(starts, 1);
  } finally {
    await app.close();
  }
});

await test('close remains single-flight when an abort listener calls close again synchronously', async () => {
  let stops = 0;
  let destroys = 0;
  let nested: Promise<void> | undefined;
  @Injectable()
  class Resource {
    onModuleInit(signal: AbortSignal): void {
      signal.addEventListener(
        'abort',
        () => {
          nested = app.close();
          nested.catch(() => {});
        },
        { once: true },
      );
    }
    onModuleDestroy(): void {
      destroys++;
    }
  }
  @Module({ providers: [Resource] })
  class Root {}
  const app: Application = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret: 'fixture-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    {
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({
        start: () => Promise.resolve(),
        stop: () => {
          stops++;
          return Promise.resolve();
        },
      }),
    },
  );
  await app.start();
  const first = app.close();
  await first;
  await nested;
  assert.equal(nested, first);
  assert.equal(stops, 1);
  assert.equal(destroys, 1);
});

await test('an init hook that initiates close is tracked until its own work has settled', async () => {
  let closing: Promise<void> | undefined;
  let destroyed = false;
  const release = deferred<void>();
  @Injectable()
  class Resource {
    onModuleInit(): Promise<void> {
      closing = app.close();
      closing.catch(() => {});
      return release.promise;
    }
    onModuleDestroy(): void {
      destroyed = true;
    }
  }
  @Module({ providers: [Resource] })
  class Root {}
  const app: Application = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret: 'fixture-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    {
      fetch: () => {
        throw new Error('Startup must not make a request after close');
      },
      transport: () => ({
        start: () => Promise.reject(new Error('Must not start')),
        stop: () => Promise.resolve(),
      }),
    },
  );
  const starting = assert.rejects(app.start(), /stopped during startup/);
  await tick();
  assert.ok(closing);
  assert.equal(destroyed, false);
  release.resolve();
  await closing;
  await starting;
  assert.equal(destroyed, true);
  assert.equal(app.status, 'stopped');
});

await test('event admission is already stopped when user abort listeners run', async () => {
  let admission: string | undefined;
  @Injectable()
  class Resource {
    onModuleInit(signal: AbortSignal): void {
      signal.addEventListener(
        'abort',
        () => {
          admission = enqueue(privateMessage('late', '/ping')).status;
        },
        { once: true },
      );
    }
  }
  @Controller()
  class Commands {
    @Command('ping') ping(): string {
      return 'pong';
    }
  }
  @Module({ providers: [Resource], controllers: [Commands] })
  class Root {}
  const bot = await createTestApplication(Root);
  const enqueue = (payload: QQDispatch) => bot.enqueue(payload);
  await bot.app.start();
  await bot.app.close();
  assert.equal(admission, 'stopping');
  assert.equal(bot.messages.length, 0);
});

await test('the shared byte budget rejects admission without reserving the rejected message identity', async () => {
  const release = deferred<void>();
  @Controller()
  class Commands {
    @Command('wait') async wait(): Promise<string> {
      await release.promise;
      return 'done';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const bot = await createTestApplication(Root, {
    execution: { concurrency: 1, queueCapacity: 4, maxEventBytes: 512, queueMaxBytes: 512 },
  });
  const message = (id: string): QQDispatch => ({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id,
      author: { id: 'user' },
      content: '/wait',
      padding: 'x'.repeat(250),
    },
  });
  await bot.app.start();
  try {
    assert.equal(bot.enqueue(message('one')).status, 'accepted');
    const retained = bot.app.snapshot().queue.retainedBytes;
    assert.ok(retained > 256 && retained <= 512);
    assert.equal(bot.enqueue(message('two')).status, 'overloaded');
    assert.equal(bot.app.snapshot().queue.retainedBytes, retained);
    release.resolve();
    await bot.flush();
    assert.equal(await bot.dispatch(message('two')), 'accepted');
    assert.equal(
      bot.enqueue(privateMessage('too-large', '/wait ' + 'x'.repeat(600))).status,
      'ignored',
    );
    assert.equal(bot.messages.length, 2);
    assert.equal(bot.app.snapshot().queue.retainedBytes, 0);
  } finally {
    release.resolve();
    await bot.app.close();
  }
});

await test('illegal return values cannot turn observers or buttons into implicit message senders', async () => {
  @Controller()
  class Commands {
    @On('C2C_MESSAGE_CREATE') observer(): string {
      return 'invalid observer return';
    }
    @Command('invalid') invalid(): number {
      return 42;
    }
    @OnButton('invalid') button(): string {
      return 'invalid button return';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const bot = await createTestApplication(Root);
  await bot.app.start();
  try {
    await bot.dispatch(privateMessage('bad-command', '/invalid'));
    await bot.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'bad-button',
        chat_type: 2,
        user_openid: 'user',
        data: { resolved: { button_id: 'invalid' } },
      },
    });
    await tick();
    assert.equal(bot.messages.length, 0);
    assert.equal(bot.acknowledgments.length, 1);
    assert.deepEqual(bot.errors.map((entry) => entry.context.phase).sort(), [
      'button',
      'observer',
      'send',
    ]);
    assert.deepEqual(
      bot.errors.map((entry) => `${entry.context.controller}.${entry.context.method}`).sort(),
      ['Commands.button', 'Commands.invalid', 'Commands.observer'],
    );
    assert.ok(
      bot.errors.every(
        (entry) => entry.error instanceof FrameworkError && entry.error.code === 'HANDLER_CONTRACT',
      ),
    );
  } finally {
    await bot.app.close();
  }
});

await test('manual button mode issues no acknowledgment until the business explicitly requests it', async () => {
  const release = deferred<void>();
  @Controller()
  class Buttons {
    @OnButton('press') async press(@Ctx() context: ButtonContext): Promise<void> {
      await release.promise;
      await context.ack();
    }
  }
  @Module({ controllers: [Buttons] })
  class Root {}
  const bot = await createTestApplication(Root, { interactions: { acknowledge: 'manual' } });
  await bot.app.start();
  try {
    const dispatching = bot.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'manual-button',
        chat_type: 1,
        group_openid: 'group',
        group_member_openid: 'user',
        data: { resolved: { button_id: 'press' } },
      },
    });
    await tick();
    assert.equal(bot.acknowledgments.length, 0);
    release.resolve();
    await dispatching;
    assert.deepEqual(bot.acknowledgments, [{ interactionId: 'manual-button', code: 0 }]);
    assert.equal(bot.messages.length, 0);
  } finally {
    release.resolve();
    await bot.app.close();
  }
});

await test('an unawaited context send keeps the identity of the handler that initiated it', async () => {
  const response = deferred<Response>();
  @Controller()
  class EmitCommands {
    @Command('emit') emit(@Ctx() context: MessageContext): void {
      context.reply('fixture').catch(() => {});
    }
  }
  @Module({ controllers: [EmitCommands] })
  class Root {}
  const bot = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.endsWith('/messages') ? response.promise : undefined,
  });
  await bot.app.start();
  try {
    const handling = bot.dispatch(privateMessage('unawaited', '/emit'));
    await tick();
    response.resolve(Response.json({ code: 123, message: 'fixture rejected' }));
    await handling;
    await tick();
    assert.equal(bot.errors.length, 1);
    assert.equal(bot.errors[0]?.context.phase, 'send');
    assert.equal(bot.errors[0]?.context.controller, 'EmitCommands');
    assert.equal(bot.errors[0]?.context.method, 'emit');
  } finally {
    await bot.app.close();
  }
});
