import test from 'node:test';
import assert from 'node:assert/strict';
import { Container } from '../src/core/container.js';
import {
  Arg,
  Args,
  Command,
  Controller,
  Ctx,
  Inject,
  Injectable,
  Module,
  OnButton,
  readHandlers,
} from '../src/core/metadata.js';
import { Dispatcher } from '../src/core/dispatcher.js';
import { FrameworkError } from '../src/core/errors.js';
import { parseCommand } from '../src/core/parser.js';
import { resolveOptions } from '../src/core/config.js';
import { normalize } from '../src/qq/normalize.js';
import {
  button,
  encodeKeyboard,
  image,
  keyboard,
  markdown,
  snapshotMessage,
} from '../src/message/index.js';
import type { BotOptions, MessageContext, MessageInput } from '../src/contracts.js';
import { TypedProvider as RuntimeProvider } from './fixtures/typed-provider.js';
import type { TypedProvider } from './fixtures/typed-provider.js';

await test('diamond imports resolve the same owning binding and async factory exactly once', async () => {
  const TOKEN = Symbol('value');
  let creations = 0;
  @Injectable()
  class Service {
    constructor(@Inject(TOKEN) readonly value: { name: string }) {}
  }
  @Module({
    providers: [
      Service,
      {
        provide: TOKEN,
        useFactory: () => {
          creations++;
          return Promise.resolve({ name: 'shared' });
        },
      },
    ],
    exports: [Service],
  })
  class Shared {}
  @Module({ imports: [Shared], exports: [Service] })
  class Left {}
  @Module({ imports: [Shared], exports: [Service] })
  class Right {}
  @Module({ imports: [Left, Right] })
  class Root {}
  const container = new Container(Root);
  await Promise.all([container.initialize(), container.initialize()]);
  assert.equal(creations, 1);
  assert.equal(container.get(Service).value.name, 'shared');
  assert.equal(container.get(Service), container.get(Service, Shared));
});

await test('module boundaries and distinct bindings are enforced', () => {
  @Injectable()
  class Hidden {}
  @Module({ providers: [Hidden] })
  class Private {}
  @Injectable()
  class Consumer {
    constructor(readonly dependency: Hidden) {}
  }
  @Module({ imports: [Private], providers: [Consumer] })
  class Root {}
  assert.throws(() => new Container(Root), /not visible/);
  @Module({ providers: [{ provide: 'value', useValue: 1 }], exports: ['value'] })
  class A {}
  @Module({ providers: [{ provide: 'value', useValue: 2 }], exports: ['value'] })
  class B {}
  @Injectable()
  class Ambiguous {
    constructor(@Inject('value') readonly value: number) {}
  }
  @Module({ imports: [A, B], providers: [Ambiguous] })
  class Bad {}
  assert.throws(() => new Container(Bad), /Ambiguous/);
});

await test('duplicate providers and cycles fail before constructing anything', () => {
  let constructed = 0;
  @Injectable()
  class Value {
    constructor() {
      constructed++;
    }
  }
  @Module({ providers: [Value, Value] })
  class Duplicate {}
  assert.throws(() => new Container(Duplicate), /Duplicate/);
  @Module({
    providers: [
      Value,
      {
        provide: 'a',
        inject: ['b'],
        useFactory: () => {
          constructed++;
          return 'a';
        },
      },
      {
        provide: 'b',
        inject: ['a'],
        useFactory: () => {
          constructed++;
          return 'b';
        },
      },
    ],
  })
  class Circular {}
  assert.throws(() => new Container(Circular), /Circular providers/);
  assert.equal(constructed, 0);
  class A {}
  class B {}
  Module({ imports: [B] })(A);
  Module({ imports: [A] })(B);
  assert.throws(() => new Container(A), /Circular modules/);
});

await test('lifecycle order follows dependencies and does not destroy external values', async () => {
  const calls: string[] = [];
  const external = {
    onModuleDestroy: () => {
      calls.push('external');
    },
  };
  @Injectable()
  class Dependency {
    onModuleInit(): void {
      calls.push('dependency init');
    }
    onModuleDestroy(): void {
      calls.push('dependency destroy');
    }
  }
  @Injectable()
  class Consumer {
    constructor(readonly dependency: Dependency) {}
    onModuleInit(): void {
      calls.push('consumer init');
    }
    onModuleDestroy(): void {
      calls.push('consumer destroy');
    }
  }
  @Module({
    providers: [
      Consumer,
      Dependency,
      { provide: 'external', useValue: external },
      { provide: 'alias', useFactory: () => external },
    ],
  })
  class Root {}
  const container = new Container(Root);
  await container.initialize();
  await container.callInitHooks(new AbortController().signal);
  await container.destroy(performance.now() + 1000);
  await container.destroy(performance.now() + 1000);
  assert.deepEqual(calls, [
    'dependency init',
    'consumer init',
    'consumer destroy',
    'dependency destroy',
  ]);
});

await test('cleanup continues after failures and cancels an unresponsive hook', async () => {
  const calls: string[] = [];
  let aborted = false;
  @Injectable()
  class First {
    onModuleDestroy(): void {
      calls.push('first');
    }
  }
  @Injectable()
  class Failing {
    onModuleDestroy(): void {
      throw new Error('fixture cleanup failure');
    }
  }
  @Injectable()
  class Slow {
    onModuleDestroy(signal: AbortSignal): Promise<void> {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
        },
        { once: true },
      );
      return new Promise(() => {});
    }
  }
  @Module({ providers: [First, Failing, Slow] })
  class Root {}
  const container = new Container(Root);
  await container.initialize();
  await assert.rejects(
    container.destroy(performance.now() + 20),
    (error: unknown) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
  );
  assert.equal(aborted, true);
  assert.deepEqual(calls, ['first']);
});

await test('an undefined value is a registered provider, not a missing dependency', async () => {
  @Module({ providers: [{ provide: 'nothing', useValue: undefined }] })
  class Root {}
  const container = new Container(Root);
  await container.initialize();
  assert.equal(container.get('nothing'), undefined);
});

await test('primitive constructor metadata needs an explicit injection token', () => {
  @Injectable()
  class Bad {
    constructor(readonly value: string) {}
  }
  @Module({ providers: [Bad] })
  class Root {}
  assert.throws(() => new Container(Root), /Cannot infer Bad constructor parameter 0/);
});

await test('routes honor instance inheritance and reject command or button collisions', () => {
  @Controller()
  class Base {
    @Command('base') execute(@Arg(0) name = 'world'): string {
      return name;
    }
  }
  @Controller()
  class Child extends Base {
    override execute(name = 'world'): string {
      return name;
    }
  }
  assert.equal(readHandlers(Base).length, 1);
  assert.equal(readHandlers(Child).length, 0);
  @Controller()
  class First {
    @Command('ping', { aliases: ['p'] }) ping(): string {
      return 'pong';
    }
  }
  @Controller()
  class Second {
    @Command('p') p(): string {
      return 'bad';
    }
  }
  @Module({ controllers: [First, Second] })
  class Root {}
  assert.throws(() => new Dispatcher(new Container(Root), '/'), /Duplicate/);
  @Controller()
  class Buttons {
    @OnButton('same') one(): void {}
    @OnButton('same') two(): void {}
  }
  @Module({ controllers: [Buttons] })
  class ButtonRoot {}
  assert.throws(() => new Dispatcher(new Container(ButtonRoot), '/'), /Duplicate/);
});

await test('parameter metadata includes defaults and rejects undecorated arguments', () => {
  @Controller()
  class Valid {
    @Command('echo') echo(
      @Arg(0) name = 'world',
      @Args() all: string[],
      @Ctx() ctx: MessageContext,
    ): string {
      return name + all.length + ctx.scene;
    }
  }
  assert.equal(readHandlers(Valid)[0]?.parameters.length, 3);
  @Controller()
  class Bad {
    @Command('bad') bad(name = 'world'): string {
      return name;
    }
  }
  assert.throws(() => readHandlers(Bad), /Invalid parameter/);
});

await test('command parsing preserves quoted empty arguments and escaped whitespace', () => {
  assert.deepEqual(parseCommand(' /hello "Ada Lovelace" \'\' one\\ two x\\ ', '/'), {
    name: 'hello',
    args: ['Ada Lovelace', '', 'one two', 'x '],
  });
  assert.equal(parseCommand('hello world', '/'), null);
  assert.throws(() => parseCommand('/hello "unterminated', '/'), /Unclosed/);
  assert.throws(() => parseCommand('/hello trailing\\', '/'), /trailing/);
});

await test('configuration captures data and rejects mixed transport or inconsistent capacity', () => {
  const input: BotOptions = {
    appId: 'fixture',
    secret: 'fixture-secret',
    execution: { concurrency: 2 },
  };
  const config = resolveOptions(input);
  input.execution = { concurrency: 8 };
  assert.equal(config.execution.concurrency, 2);
  assert.throws(
    () =>
      resolveOptions({ ...input, transport: { type: 'ws', port: 8080 } } as unknown as BotOptions),
    /Unknown ws.port/,
  );
  assert.throws(
    () => resolveOptions({ ...input, execution: { queueCapacity: 100, dedupMaxEntries: 1 } }),
    /capacities/,
  );
  assert.throws(
    () => resolveOptions({ ...input, api: { baseUrl: 'https://user:password@example.invalid' } }),
    /credentials/,
  );
});

await test('command prefix configuration supports custom and empty strings while rejecting invalid values', () => {
  const base = { appId: 'fixture', secret: 'fixture-secret' };
  assert.equal(resolveOptions(base).prefix, '/');
  assert.equal(resolveOptions({ ...base, commands: {} }).prefix, '/');
  for (const prefix of ['', '!', 'bot:', '！']) {
    assert.equal(resolveOptions({ ...base, commands: { prefix } }).prefix, prefix);
  }
  for (const prefix of [null, false, 0, [], {}, ' ', '\t', '\n', '! ', 'b ot', '\u00a0']) {
    assert.throws(
      () => resolveOptions({ ...base, commands: { prefix } } as unknown as BotOptions),
      (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
    );
  }
});

await test('QQ message normalization handles both field families without inventing identity', () => {
  const result = normalize(
    {
      op: 0,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: {
        id: 'm',
        group_openid: 'g',
        author: { member_openid: 'u' },
        content: '/hello',
        message_scene: { ext: ['msg_idx=index'] },
        attachments: [{ url: 'https://example.invalid/a', content_type: 'image/png' }],
      },
    },
    123,
  );
  assert.ok(result.status === 'ok' && result.event.kind === 'message');
  assert.deepEqual(result.event.target, { scene: 'group', groupId: 'g' });
  assert.equal(result.event.userId, 'u');
  assert.equal(result.event.sourceIndex, 'index');
  assert.equal(result.event.receivedAt, 123);
  assert.equal(result.event.attachments.length, 1);
  const bad = normalize({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm', author: {} } });
  assert.equal(bad.status, 'invalid');
  const attachmentOnly = normalize({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'attachment-only',
      author: { user_openid: 'user' },
      attachments: [{ url: 'https://example.invalid/image.png', content_type: 'image/png' }],
    },
  });
  assert.ok(attachmentOnly.status === 'ok' && attachmentOnly.event.kind === 'message');
  assert.equal(attachmentOnly.event.content, '');
  assert.equal(attachmentOnly.event.attachments[0]?.contentType, 'image/png');
});

await test('group normalization removes only leading self mentions and preserves the raw event', () => {
  const cases: { content: string; mentions: unknown; expected: string }[] = [
    {
      content: ' <@self> /hello "Ada Lovelace"',
      mentions: [{ id: 'self', is_you: true }],
      expected: '/hello "Ada Lovelace"',
    },
    {
      content: '<@!self>\n<@self> /hello',
      mentions: [{ id: 'self', is_you: true }],
      expected: '/hello',
    },
    {
      content: '<@alias> /hello',
      mentions: [{ member_openid: 'alias', is_you: true }],
      expected: '/hello',
    },
    { content: '<@self>/hello', mentions: [{ id: 'self', is_you: true }], expected: '/hello' },
    {
      content: '<@other> /hello',
      mentions: [
        { id: 'self', is_you: true },
        { id: 'other', bot: true },
      ],
      expected: '<@other> /hello',
    },
    {
      content: '<@self> /hello',
      mentions: [{ id: 'self', is_you: 'true' }],
      expected: '<@self> /hello',
    },
    { content: '<@self> /hello', mentions: [null, 1, 'self'], expected: '<@self> /hello' },
    {
      content: '<@self> /hello',
      mentions: { id: 'self', is_you: true },
      expected: '<@self> /hello',
    },
    {
      content: '<@self> /hello <@other> <@self> x\\ ',
      mentions: [{ id: 'self', is_you: true }],
      expected: '/hello <@other> <@self> x\\ ',
    },
    {
      content: ' /hello <@self>',
      mentions: [{ id: 'self', is_you: true }],
      expected: ' /hello <@self>',
    },
  ];
  for (const eventType of [
    'GROUP_AT_MESSAGE_CREATE',
    'GROUP_MESSAGE_CREATE',
    'C2C_MESSAGE_CREATE',
  ]) {
    for (const fixture of cases) {
      const data = {
        id: 'm',
        group_id: 'g',
        author: { id: 'u' },
        content: fixture.content,
        mentions: fixture.mentions,
      };
      const result = normalize({ op: 0, t: eventType, d: data });
      assert.ok(result.status === 'ok' && result.event.kind === 'message');
      assert.equal(
        result.event.content,
        eventType === 'C2C_MESSAGE_CREATE' ? fixture.content : fixture.expected,
      );
      assert.equal(data.content, fixture.content);
      assert.equal(result.event.raw.d, data);
    }
  }
});

await test('message snapshots isolate buffers and reject contradictory keyboard data', () => {
  const original = new Uint8Array([1, 2]);
  const captured = snapshotMessage(image(original));
  original[0] = 9;
  assert.ok(captured.kind === 'image' && captured.source instanceof Uint8Array);
  assert.equal(captured.source[0], 1);
  const keys = keyboard([[button.callback('choose', 'Choose', 'a')]]);
  const encoded = encodeKeyboard(keys);
  assert.equal(encoded.content?.rows[0]?.buttons[0]?.action.type, 1);
  assert.equal(encoded.content?.rows[0]?.buttons[0]?.render_data.visited_label, 'Choose');
  assert.equal(
    encodeKeyboard(keyboard([[button.callback('blank', 'Visible', '', { visitedLabel: '' })]]))
      .content?.rows[0]?.buttons[0]?.render_data.visited_label,
    '',
  );
  assert.throws(
    () => encodeKeyboard(keyboard([[button.callback('x', 'One'), button.callback('x', 'Two')]])),
    /Duplicate/,
  );
  assert.throws(
    () =>
      snapshotMessage({
        kind: 'markdown',
        body: { content: 'a', templateId: 'b', params: {} },
      } as unknown as MessageInput),
    /not supported/,
  );
  assert.equal(snapshotMessage(markdown('**keep**')).kind, 'markdown');
});

await test('erased imports and implicit inherited constructors require explicit runtime injection metadata', async () => {
  @Injectable()
  class Erased {
    constructor(readonly provider: TypedProvider) {}
  }
  @Module({ providers: [RuntimeProvider, Erased] })
  class ErasedRoot {}
  assert.throws(() => new Container(ErasedRoot), /Cannot infer/);
  @Injectable()
  class Explicit {
    constructor(@Inject(RuntimeProvider) readonly provider: TypedProvider) {}
  }
  @Injectable()
  class Base {
    constructor(readonly provider: RuntimeProvider) {}
  }
  @Injectable()
  class ImplicitChild extends Base {}
  @Module({ providers: [RuntimeProvider, ImplicitChild] })
  class ImplicitRoot {}
  assert.throws(() => new Container(ImplicitRoot), /explicitly declare its inherited constructor/);
  @Injectable()
  class ExplicitChild extends Base {
    constructor(provider: RuntimeProvider) {
      super(provider);
    }
  }
  @Module({ providers: [RuntimeProvider, Explicit, ExplicitChild] })
  class Root {}
  const container = new Container(Root);
  await container.initialize();
  assert.equal(container.get(Explicit).provider, container.get(RuntimeProvider));
  assert.equal(container.get(ExplicitChild).provider, container.get(RuntimeProvider));
});

await test('identity alias disagreements retain the preferred identifiers and expose field names only', () => {
  const result = normalize({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'message',
      group_id: 'preferred-group',
      group_openid: 'alias-group',
      author: { id: 'preferred-user', member_openid: 'alias-user' },
      content: '/fixture',
    },
  });
  assert.ok(result.status === 'ok' && result.event.kind === 'message');
  assert.deepEqual(result.event.target, { scene: 'group', groupId: 'preferred-group' });
  assert.equal(result.event.userId, 'preferred-user');
  assert.deepEqual(result.conflictingFields, ['author.id/member_openid', 'group_id/group_openid']);
  assert.equal(JSON.stringify(result.conflictingFields).includes('preferred-user'), false);
});
