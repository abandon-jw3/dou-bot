import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Args,
  Attachments,
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  GroupId,
  HelpModule,
  Images,
  Injectable,
  Module,
  On,
  OnAttachment,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
  UserId,
} from '../src/index.js';
import type {
  ArgumentOptions,
  Attachment,
  CanActivate,
  MessageContext,
  OptionOptions,
  QQDispatch,
  SlotOptions,
  Type,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';
import { CommandArguments } from '../src/core/arguments.js';
import { tokenizeCommand } from '../src/core/parser.js';

let next = 0;
function message(content: string, group = false, withImage = false): QQDispatch {
  return {
    op: 0,
    t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `slot-normalization-${++next}`,
      content,
      ...(group
        ? { group_openid: 'group', author: { member_openid: 'user' } }
        : { author: { user_openid: 'user' } }),
      ...(withImage
        ? { attachments: [{ content_type: 'image/png', url: 'https://example.test/image.png' }] }
        : {}),
    },
  };
}

async function open(t: TestContext, controller: Type, options: TestOptions = {}) {
  @Module({ imports: [HelpModule], controllers: [controller] })
  class Root {}
  const harness = await createTestApplication(Root, options);
  t.after(() => harness.app.close());
  await harness.app.start();
  return harness;
}

await test('Slot normalizes aliases selected by choices, match or their intersection in both scenes', async (t) => {
  const aliases = new Set(['梦江南', '双梦']);
  const rules: SlotOptions[] = [
    { choices: [...aliases] },
    { match: (text) => aliases.has(text) },
    { choices: [...aliases, 'excluded'], match: (text) => aliases.has(text) },
  ];
  for (const rule of rules) {
    const normalized: string[] = [];
    @Controller()
    class Status {
      @Command('状态') status(
        @Slot('server', {
          ...rule,
          required: true,
          normalize: (text) => {
            normalized.push(text);
            return '梦江南';
          },
        })
        server: string,
        @Rest() rest: string[],
      ): string {
        return JSON.stringify({ server, rest });
      }
    }
    const harness = await open(t, Status, { commands: { prefix: '' } });
    for (const group of [false, true]) {
      for (const input of aliases) {
        await harness.dispatch(message(`状态 ${input} excluded`, group));
        assert.deepEqual(JSON.parse(harness.messages.at(-1)!.payload.content!), {
          server: '梦江南',
          rest: ['excluded'],
        });
      }
    }
    assert.deepEqual(normalized, ['梦江南', '双梦', '梦江南', '双梦']);
    assert.deepEqual(harness.errors, []);
  }
});

await test('Slot defaults normalize once per application while help retains the accepted raw default', async (t) => {
  const calls: string[] = [];
  @Controller()
  class Status {
    @Command('状态') status(
      @Slot('server', {
        choices: ['双梦'],
        match: (text) => {
          calls.push(`match:${text}`);
          return text === '双梦';
        },
        default: '双梦',
        normalize: (text) => {
          calls.push(`normalize:${text}`);
          return '梦江南';
        },
      })
      server: string,
    ): string {
      return server;
    }
  }
  for (let application = 0; application < 2; application++) {
    calls.length = 0;
    const harness = await open(t, Status);
    assert.deepEqual(calls, ['match:双梦', 'normalize:双梦']);
    await harness.dispatch(message('/状态'));
    await harness.dispatch(message('/状态'));
    assert.deepEqual(
      harness.messages.map((entry) => entry.payload.content),
      ['梦江南', '梦江南'],
    );
    await harness.dispatch(message('/help 状态'));
    const help = harness.messages.at(-1)!.payload.content!;
    assert.match(help, /默认 "双梦"/u);
    assert.match(help, /可选值 双梦/u);
    assert.doesNotMatch(help, /梦江南/u);
    assert.deepEqual(calls, ['match:双梦', 'normalize:双梦']);
    await harness.dispatch(message('/状态 双梦'));
    assert.deepEqual(calls, ['match:双梦', 'normalize:双梦', 'match:双梦', 'normalize:双梦']);
    assert.equal(harness.messages.at(-1)!.payload.content, '梦江南');
    assert.deepEqual(harness.errors, []);
  }
});

await test('optional missing Slots bypass normalization and empty inputs, outputs and defaults remain strings', async (t) => {
  const seen: unknown[] = [];
  const calls: string[] = [];
  const normalize = (text: string): string => {
    calls.push(text);
    return text === '' ? 'empty input' : '';
  };
  @Controller()
  class Status {
    @Command('optional') optional(
      @Slot('server', { choices: ['双梦'], normalize }) server: string | undefined,
    ): void {
      seen.push(server);
    }
    @Command('required') required(
      @Slot('server', { choices: ['', '双梦'], required: true, normalize }) server: string,
    ): void {
      seen.push(server);
    }
    @Command('default') fallback(
      @Slot('server', { choices: ['双梦'], default: '双梦', normalize }) server: string,
    ): void {
      seen.push(server);
    }
    @Command('unchanged') unchanged(@Slot('server', { choices: ['双梦'] }) server: string): void {
      seen.push(server);
    }
  }
  const harness = await open(t, Status);
  assert.deepEqual(calls, ['双梦']);
  for (const input of [
    '/optional',
    '/required ""',
    '/required 双梦',
    '/default',
    '/unchanged 双梦',
  ])
    await harness.dispatch(message(input));
  assert.deepEqual(seen, [undefined, 'empty input', '', '', '双梦']);
  assert.deepEqual(calls, ['双梦', '', '双梦']);
  assert.deepEqual(harness.errors, []);
});

await test('normalization follows parameter order without consuming or rewriting other bindings or raw input', async (t) => {
  const calls: string[] = [];
  const seen: unknown[] = [];
  @Controller()
  class Status {
    @Command('mix') status(
      @Args() all: string[],
      @Rest() rest: string[],
      @UserId() user: string,
      @Slot('topic', {
        choices: ['状态'],
        normalize: (text) => {
          calls.push(`topic:${text}`);
          return 'status';
        },
      })
      topic: string,
      @Arg(0) keyword: string,
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @Slot('server', {
        choices: [' 双梦 '],
        normalize: (text) => {
          calls.push(`server:${text}`);
          return '梦江南';
        },
      })
      server: string,
      @Option('page', { alias: 'p', type: 'integer' }) page: number,
      @Attachments() attachments: readonly Attachment[],
      @GroupId() group: string | undefined,
      @Ctx() ctx: MessageContext,
    ): void {
      assert.equal(user, ctx.userId);
      assert.deepEqual(images, ctx.attachments);
      assert.deepEqual(attachments, ctx.attachments);
      seen.push({ all, rest, user, topic, keyword, server, page, group, content: ctx.content });
    }
  }
  const harness = await open(t, Status);
  const content = '/mix keyword " 双梦 " note -p 2 状态 extra';
  for (const group of [false, true]) {
    const event = message(content, group, true);
    const original = structuredClone(event);
    await harness.dispatch(event);
    assert.deepEqual(event, original);
    assert.deepEqual(seen.at(-1), {
      all: ['keyword', ' 双梦 ', 'note', '-p', '2', '状态', 'extra'],
      rest: ['note', 'extra'],
      user: 'user',
      topic: 'status',
      keyword: 'keyword',
      server: '梦江南',
      page: 2,
      group: group ? 'group' : undefined,
      content,
    });
  }
  assert.deepEqual(calls, ['topic:状态', 'server: 双梦 ', 'topic:状态', 'server: 双梦 ']);
  assert.deepEqual(harness.errors, []);
});

await test('every text validation completes before any Slot normalization', async (t) => {
  const calls: string[] = [];
  const normalize = (text: string): string => {
    calls.push(text);
    return text;
  };
  @Controller()
  class Status {
    @Command('query') query(
      @Slot('server', { choices: ['梦江南', '双梦', '共同'], required: true, normalize })
      server: string,
      @Slot('topic', { choices: ['状态', '共同'], required: true, normalize }) topic: string,
      @Arg(0, { type: 'integer', required: true }) count: number,
      @Option('page', { type: 'integer' }) page: number | undefined,
    ): void {
      void [server, topic, count, page];
      calls.push('handler');
    }
    @Command('rest') relaxed(
      @Slot('server', { choices: ['梦江南', '双梦'], normalize }) server: string,
      @Rest() rest: string[],
    ): void {
      void [server, rest];
      calls.push('handler');
    }
  }
  const harness = await open(t, Status, { commands: { invalidInput: 'reply' } });
  const cases = [
    ['/query 1 双梦', /缺少必填/u],
    ['/query 1 梦江南 双梦 状态', /多个匹配值/u],
    ['/query 1 共同', /同时匹配/u],
    ['/query 1 双梦 状态 extra', /未识别/u],
    ['/query 1 双梦 状态 --unknown', /未声明/u],
    ['/query x 双梦 状态', /安全整数/u],
    ['/query 1 双梦 状态 --page x', /安全整数/u],
    ['/query "unfinished', /引号/u],
    ['/rest 梦江南 双梦 note', /多个匹配值/u],
  ] as const;
  for (const [input, expected] of cases) {
    await harness.dispatch(message(input));
    assert.match(harness.messages.at(-1)!.payload.content!, expected);
    assert.deepEqual(calls, []);
  }
  assert.equal(harness.errors.length, cases.length);
  assert.ok(
    harness.errors.every(
      ({ error }) => error instanceof FrameworkError && error.code === 'PARAMETER_PARSE',
    ),
  );
});

await test('guards precede normalization, normalization precedes attachments, and failed bindings leave cooldown free', async (t) => {
  const calls: string[] = [];
  let allowed = false;
  const cause = new FrameworkError('PARAMETER_PARSE', 'private callback detail');
  @Injectable()
  class Access implements CanActivate {
    canActivate(): boolean {
      calls.push('guard');
      return allowed;
    }
  }
  @Controller()
  class Status {
    @Command('状态')
    @UseGuards(Access)
    @Cooldown({ scope: 'user', durationMs: 60000, message: false })
    status(
      @Slot('server', {
        choices: ['双梦', 'broken'],
        normalize: (text) => {
          calls.push('normalize');
          if (text === 'broken') throw cause;
          return '梦江南';
        },
      })
      server: string,
      @Images({ minCount: 1 }) images: readonly Attachment[],
    ): string {
      void images;
      calls.push('handler');
      return server;
    }
  }
  @Module({ controllers: [Status], providers: [Access] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/状态 broken'));
  assert.deepEqual(calls, ['guard']);
  assert.equal(harness.errors.length, 0);
  allowed = true;
  await harness.dispatch(message('/状态 broken'));
  assert.deepEqual(calls, ['guard', 'guard', 'normalize']);
  assert.equal(harness.messages.length, 0);
  assert.equal(harness.errors.length, 1);
  const failure = harness.errors[0]!;
  assert.ok(failure.error instanceof FrameworkError);
  assert.equal(failure.error.code, 'HANDLER_CONTRACT');
  // ErrorReporter preserves its existing sanitized hook shape; causes stay on the internal error.
  assert.equal(failure.error.cause, undefined);
  assert.doesNotMatch(failure.error.message, /private callback detail/u);
  assert.equal(failure.context.phase, 'command');
  await harness.dispatch(message('/状态 双梦'));
  assert.equal(harness.errors.length, 2);
  assert.match(harness.messages.at(-1)!.payload.content!, /数量不能少于/u);
  await harness.dispatch(message('/状态 双梦', false, true));
  assert.equal(harness.messages.at(-1)!.payload.content, '梦江南');
  await harness.dispatch(message('/状态 双梦', false, true));
  assert.equal(harness.messages.length, 2);
  assert.deepEqual(calls, [
    'guard',
    'guard',
    'normalize',
    'guard',
    'normalize',
    'guard',
    'normalize',
    'handler',
    'guard',
    'normalize',
  ]);
  assert.equal(harness.errors.length, 2);
});

const invalidResults: (() => unknown)[] = [
  () => undefined,
  () => null,
  () => 42,
  () => false,
  () => ({ name: '梦江南' }),
  () => Promise.resolve('梦江南'),
  () => Promise.reject(new Error('private rejection')),
];

await test('runtime normalization preserves the original cause before error reporting sanitizes it', () => {
  const cause = new Error('private callback detail');
  const arguments_ = new CommandArguments([
    {
      kind: 'slot',
      index: 0,
      key: 'server',
      options: {
        choices: ['双梦'],
        normalize: () => {
          throw cause;
        },
      },
    },
  ]);
  assert.throws(
    () => arguments_.bind(tokenizeCommand('/状态 双梦', '/')!.tokens, {}),
    (error: unknown) => {
      assert.ok(error instanceof FrameworkError);
      assert.equal(error.code, 'HANDLER_CONTRACT');
      assert.equal(error.cause, cause);
      return true;
    },
  );
});

await test('non-string and asynchronous normalization fail once without automatic replies or unhandled rejections', async (t) => {
  for (const invalidInput of ['reply', 'report'] as const) {
    for (const result of invalidResults) {
      let invoked = false;
      @Controller()
      class Status {
        @Command('状态') status(
          @Slot('server', { choices: ['双梦'], normalize: result as (text: string) => string })
          server: string,
        ): void {
          void server;
          invoked = true;
        }
      }
      const harness = await open(t, Status, { commands: { invalidInput } });
      await harness.dispatch(message('/状态 双梦'));
      await tick();
      assert.equal(invoked, false);
      assert.deepEqual(harness.messages, []);
      assert.equal(harness.errors.length, 1);
      const failure = harness.errors[0]!;
      assert.ok(failure.error instanceof FrameworkError);
      assert.equal(failure.error.code, 'HANDLER_CONTRACT');
      assert.equal(failure.context.phase, 'command');
    }
  }
});

await test('invalid normalization configuration and unmatched defaults fail before callbacks or construction', async () => {
  let calls = 0;
  const normalize = (text: string): string => {
    calls++;
    return text;
  };
  const declarations = [
    ...[null, true, 'text', 1].map((value) =>
      Slot('server', { choices: ['双梦'], normalize: value } as unknown as SlotOptions),
    ),
    Slot('server', { normalize } as SlotOptions),
    Slot('server', { choices: ['双梦'], default: '梦江南', normalize }),
    Slot('server', { choices: ['双梦'], match: () => false, default: '双梦', normalize }),
    Slot('server', { choices: ['双梦'], required: true, default: '双梦', normalize }),
    Arg(0, { normalize } as unknown as ArgumentOptions),
    Option('server', { normalize } as unknown as OptionOptions),
  ];
  for (const declaration of declarations) {
    @Controller()
    class Status {
      constructor() {
        calls++;
      }
      @Command('状态') status(server: string): void {
        void server;
      }
    }
    declaration(Status.prototype, 'status', 0);
    @Module({ controllers: [Status] })
    class Root {}
    await assert.rejects(
      createTestApplication(Root),
      (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
    );
  }
  assert.equal(calls, 0);
});

await test('default normalization contracts fail during bootstrap and preserve thrown causes', async () => {
  const cause = new Error('private default detail');
  let constructed = 0;
  for (const normalize of [
    ...invalidResults,
    () => {
      throw cause;
    },
  ]) {
    @Controller()
    class Status {
      constructor() {
        constructed++;
      }
      @Command('状态') status(
        @Slot('server', {
          choices: ['双梦'],
          default: '双梦',
          normalize: normalize as (text: string) => string,
        })
        server: string,
      ): void {
        void server;
      }
    }
    @Module({ controllers: [Status] })
    class Root {}
    await assert.rejects(createTestApplication(Root), (error: unknown) => {
      assert.ok(error instanceof FrameworkError);
      assert.equal(error.code, 'HANDLER_CONTRACT');
      if (error.message.includes('normalizer failed')) assert.equal(error.cause, cause);
      return true;
    });
    await tick();
  }
  assert.equal(constructed, 0);
});

await test('inherited Slots retain the declaration snapshot including the original normalizer and default', async (t) => {
  const choices = ['双梦'];
  let calls = 0;
  const options: SlotOptions = {
    choices,
    default: '双梦',
    normalize: () => {
      calls++;
      return '梦江南';
    },
  };
  @Controller()
  class Base {
    @Command('状态') status(@Slot('server', options) server: string): string {
      return server;
    }
  }
  @Controller()
  class Derived extends Base {}
  options.normalize = () => 'replacement';
  options.default = 'replacement';
  choices.push('replacement');
  const harness = await open(t, Derived);
  assert.equal(calls, 1);
  await harness.dispatch(message('/状态'));
  await harness.dispatch(message('/状态 双梦'));
  await harness.dispatch(message('/状态 replacement'));
  assert.deepEqual(
    harness.messages.map((entry) => entry.payload.content),
    ['梦江南', '梦江南'],
  );
  assert.equal(calls, 2);
  assert.equal(harness.errors.length, 1);
});

await test('normalization does not expand Slot placement beyond command parameters', async () => {
  let calls = 0;
  const options: SlotOptions = {
    choices: ['双梦'],
    normalize: (text) => {
      calls++;
      return text;
    },
  };
  for (const route of [On('C2C_MESSAGE_CREATE'), OnButton('button'), OnAttachment()]) {
    @Controller()
    class Invalid {
      action(@Slot('server', options) value: string): void {
        void value;
      }
    }
    route(
      Invalid.prototype,
      'action',
      Object.getOwnPropertyDescriptor(Invalid.prototype, 'action')!,
    );
    @Module({ controllers: [Invalid] })
    class Root {}
    await assert.rejects(
      createTestApplication(Root),
      (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
    );
  }
  class InvalidConstructor {}
  assert.throws(
    () => Slot('server', options)(InvalidConstructor, undefined, 0),
    (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
  );
  assert.equal(calls, 0);
});
