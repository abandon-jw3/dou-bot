import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Args,
  Command,
  Controller,
  Ctx,
  FrameworkError,
  HelpModule,
  Module,
  On,
  OnButton,
  Option,
  Rest,
  Slot,
} from '../src/index.js';
import type {
  ArgumentOptions,
  BotOptions,
  MessageContext,
  OptionOptions,
  QQDispatch,
  SlotOptions,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { resolveOptions } from '../src/core/config.js';

let nextId = 0;
const json = (content: string): Record<string, unknown> =>
  JSON.parse(content) as Record<string, unknown>;
function message(content: string, group = false): QQDispatch {
  const id = `arguments-${++nextId}`;
  return group
    ? {
        op: 0,
        t: 'GROUP_MESSAGE_CREATE',
        d: { id, group_openid: 'group', author: { member_openid: 'user' }, content },
      }
    : { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { user_openid: 'user' }, content } };
}
function permutations<T>(items: T[]): T[][] {
  if (!items.length) return [[]];
  return items.flatMap((item, index) =>
    permutations(items.filter((_, i) => i !== index)).map((rest) => [item, ...rest]),
  );
}

await test('Slots accept all word orders, while Rest preserves only unconsumed tokens in group and private chats', async (t) => {
  @Controller()
  class Query {
    @Command('查询', { aliases: ['查'] })
    query(
      @Rest({ name: '补充内容' }) remaining: string[],
      @Slot('topic', { name: '查询类型', required: true, choices: ['天气', '空气质量'] })
      topic: string,
      @Slot('city', {
        name: '城市',
        required: true,
        match: (text) => ['北京', '上海'].includes(text),
      })
      city: string,
      @Ctx() context: MessageContext,
    ): string {
      return JSON.stringify({ city, topic, remaining, scene: context.scene });
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { prefix: '' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  for (const group of [false, true]) {
    for (const tokens of permutations(['北京', '天气', '今天', '详细'])) {
      await harness.dispatch(message(`查询 ${tokens.join(' ')}`, group));
      assert.deepEqual(json(harness.messages.at(-1)!.payload.content!), {
        city: '北京',
        topic: '天气',
        remaining: tokens.filter((token) => ['今天', '详细'].includes(token)),
        scene: group ? 'group' : 'private',
      });
    }
    await harness.dispatch(message('查 北京 空气质量 "未来 三天"', group));
    assert.deepEqual(json(harness.messages.at(-1)!.payload.content!).remaining, ['未来 三天']);
    await harness.dispatch(message('查询 天气 北京', group));
    assert.deepEqual(json(harness.messages.at(-1)!.payload.content!).remaining, []);
  }
  assert.equal(harness.errors.length, 0);
});

await test('Rest never hides missing slots, duplicate candidates or overlapping slot rules', async (t) => {
  let calls = 0;
  @Controller()
  class Query {
    @Command('query') query(
      @Slot('city', { name: '城市', required: true, choices: ['北京', '上海', '共同'] })
      _city: string,
      @Rest() _rest: string[],
      @Slot('topic', { name: '类型', required: true, choices: ['天气', '共同'] }) _topic: string,
    ): void {
      void [_city, _rest, _topic];
      calls++;
    }
    @Command('strict') strict(@Slot('city', { choices: ['北京'] }) city?: string): void {
      void city;
      calls++;
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  const cases = [
    ['/query 天气 今天', /缺少必填参数：城市/u],
    ['/query 北京 今天', /缺少必填参数：类型/u],
    ['/query 北京 上海 天气 今天', /城市 收到了多个/u],
    ['/query 天气 北京 北京', /城市 收到了多个/u],
    ['/query 共同', /同时匹配/u],
    ['/strict 北京 今天', /未识别/u],
    ['/query 北京 天气 --unknown', /未声明的选项/u],
  ] as const;
  for (const [input, expected] of cases) {
    await harness.dispatch(message(input));
    assert.match(harness.messages.at(-1)!.payload.content!, expected);
  }
  await tick();
  assert.equal(calls, 0);
  assert.equal(harness.messages.length, cases.length);
  assert.equal(harness.errors.length, cases.length);
  assert.ok(
    harness.errors.every(
      ({ error, context }) =>
        error instanceof FrameworkError &&
        error.code === 'PARAMETER_PARSE' &&
        context.controller === 'Query' &&
        context.phase === 'command',
    ),
  );
});

await test('options consume values before positions and slots, Args is a complete snapshot, Rest is independent of declaration order', async (t) => {
  @Controller()
  class Query {
    @Command('query') query(
      @Args() all: string[],
      @Rest() rest: string[],
      @Slot('city', { required: true, choices: ['北京'] }) city: string,
      @Arg(0, { required: true }) keyword: string,
      @Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number,
      @Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean,
      @Option('tag') tag?: string,
    ): string {
      return JSON.stringify({ keyword, city, rest, all, page, detail, tag });
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/query --page 2 固定 天气 北京 -d --tag=北京 "未来 三天"'));
  assert.deepEqual(json(harness.messages[0]!.payload.content!), {
    keyword: '固定',
    city: '北京',
    page: 2,
    detail: true,
    tag: '北京',
    rest: ['天气', '未来 三天'],
    all: ['--page', '2', '固定', '天气', '北京', '-d', '--tag=北京', '未来 三天'],
  });
  await harness.dispatch(message('/query 固定 -p=3 北京 --detail=false'));
  assert.deepEqual(json(harness.messages[1]!.payload.content!), {
    keyword: '固定',
    city: '北京',
    page: 3,
    detail: false,
    rest: [],
    all: ['固定', '-p=3', '北京', '--detail=false'],
  });
  await harness.dispatch(message('/query 固定 北京'));
  assert.equal(json(harness.messages[2]!.payload.content!).page, 1);
  assert.equal(json(harness.messages[2]!.payload.content!).detail, false);
  assert.equal(harness.errors.length, 0);
});

await test('quoted or escaped option-like words and -- reach Rest unchanged; quoted empty tokens survive', async (t) => {
  @Controller()
  class Query {
    @Command('echo') echo(@Rest() rest: string[], @Option('tag') tag?: string): string {
      return JSON.stringify({ rest, tag });
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  await harness.app.start();
  const input = '/echo "--foo" \\-x \'\' --tag="a b" one\\ two x\\  -- --tag -- z';
  await harness.dispatch(message(input));
  assert.deepEqual(json(harness.messages[0]!.payload.content!), {
    tag: 'a b',
    rest: ['--foo', '-x', '', 'one two', 'x ', '--tag', '--', 'z'],
  });
  await harness.dispatch(message('/echo --tag "--"'));
  assert.deepEqual(json(harness.messages[1]!.payload.content!), { tag: '--', rest: [] });
  assert.equal(harness.errors.length, 0);
});

await test('typed arguments reject malformed, unsafe and out-of-range numbers; boolean flags and repeated options are explicit', async (t) => {
  const calls: unknown[][] = [];
  @Controller()
  class Query {
    @Command('integer') integer(
      @Arg(0, { type: 'integer', required: true, min: -5, max: 10 }) n: number,
    ): void {
      calls.push([n]);
    }
    @Command('number') number(@Arg(0, { type: 'number', required: true }) n: number): void {
      calls.push([n]);
    }
    @Command('choice') choice(
      @Arg(0, { type: 'integer', choices: [1, 3], default: 1 }) n: number,
    ): void {
      calls.push([n]);
    }
    @Command('bool') bool(@Arg(0, { type: 'boolean', required: true }) value: boolean): void {
      calls.push([value]);
    }
    @Command('options') options(
      @Option('count', { alias: 'c', type: 'integer', required: true }) count: number,
      @Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean,
    ): void {
      calls.push([count, detail]);
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  for (const input of [
    '/integer -5',
    '/integer +10',
    '/number .5',
    '/number -1.5e2',
    '/choice',
    '/choice 3',
    '/bool false',
    '/options --count -3 -d',
    '/options --count=0 --detail=false',
  ])
    await harness.dispatch(message(input));
  assert.deepEqual(calls, [[-5], [10], [0.5], [-150], [1], [3], [false], [-3, true], [0, false]]);
  for (const input of [
    '/integer',
    '/integer 1.5',
    '/integer 1e2',
    '/integer 9007199254740993',
    '/integer -6',
    '/integer 11',
    '/number NaN',
    '/number Infinity',
    '/number 0x10',
    '/number ""',
    '/number 1e400',
    '/choice 2',
    '/bool 0',
    '/options',
    '/options --count',
    '/options --count --detail',
    '/options --count 1 -c 2',
    '/options -c 1 -d --detail=false',
    '/options -c 1 --detail=1',
    '/options -cd',
    '/options -c 1 --detail false',
  ])
    await harness.dispatch(message(input));
  await tick();
  assert.equal(calls.length, 9);
  assert.equal(harness.messages.length, 21);
  assert.equal(harness.errors.length, 21);
});

await test('legacy Arg and Args preserve flags, extra arguments, undefined values and JavaScript defaults', async (t) => {
  @Controller()
  class Query {
    @Command('legacy') legacy(
      @Arg(0) first = 'default',
      @Args() all: string[],
      @Arg(5) missing?: string,
    ): string {
      return JSON.stringify({ first, all, missing });
    }
    @Command('typed') typed(
      @Arg(0, { name: '关键词', required: true }) first: string,
      @Args() all: string[],
    ): void {
      void [first, all];
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/legacy --unknown 2 tail'));
  await harness.dispatch(message('/legacy'));
  assert.deepEqual(
    harness.messages.map((m) => json(m.payload.content!)),
    [
      { first: '--unknown', all: ['--unknown', '2', 'tail'] },
      { first: 'default', all: [] },
    ],
  );
  await harness.dispatch(message('/typed key extra'));
  await tick();
  assert.equal(harness.messages.length, 2);
  assert.match(harness.errors[0]!.error.message, /未识别/u);
});

await test('optional slots default or inject undefined, and choices plus match apply together', async (t) => {
  @Controller()
  class Query {
    @Command('query') query(
      @Slot('city', {
        choices: ['北京', '上海'],
        match: (text) => text === '北京',
        default: '北京',
      })
      city: string,
      @Slot('topic', { choices: ['天气'] }) topic: string | undefined,
      @Rest() rest: string[],
    ): string {
      return JSON.stringify({ city, topic, rest });
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/query 上海'));
  await harness.dispatch(message('/query 天气 北京'));
  assert.deepEqual(
    harness.messages.map((m) => json(m.payload.content!)),
    [
      { city: '北京', rest: ['上海'] },
      { city: '北京', topic: '天气', rest: [] },
    ],
  );
});

await test('input replies are opt-in, safe, tracked once, and unknown commands remain ignored', async (t) => {
  @Controller()
  class Query {
    @Command('query') query(
      @Arg(0, { name: '页码', type: 'integer', required: true }) page: number,
    ): void {
      void page;
    }
    @Command('broken') broken(): never {
      throw new FrameworkError('PARAMETER_PARSE', 'private handler detail');
    }
    @Command('matcher') matcher(
      @Slot('x', {
        match: () => {
          throw new FrameworkError('PARAMETER_PARSE', 'private matcher detail');
        },
      })
      x?: string,
    ): void {
      void x;
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  for (const invalidInput of [undefined, 'reply'] as const) {
    const harness = await createTestApplication(Root, {
      commands: { ...(invalidInput ? { invalidInput } : {}) },
    });
    t.after(() => harness.app.close());
    await harness.app.start();
    const payload = message('/query not-a-number');
    await harness.dispatch(payload);
    await harness.dispatch(payload);
    await harness.dispatch(message('/query "unclosed'));
    await harness.dispatch(message('/broken'));
    await harness.dispatch(message('/matcher text'));
    assert.equal(await harness.dispatch(message('/unknown "unclosed')), 'ignored');
    await tick();
    assert.equal(harness.errors.length, 4);
    assert.equal(harness.messages.length, invalidInput ? 2 : 0);
    for (const reply of harness.messages) {
      assert.match(reply.payload.content!, /用法：\/query/u);
      assert.doesNotMatch(reply.payload.content!, /not-a-number|private/u);
      assert.equal(reply.payload.msg_seq, 1);
    }
  }
});

await test('async or non-boolean Slot matchers fail as internal contracts without unhandled rejections or chat replies', async (t) => {
  for (const result of [() => Promise.reject(new Error('fixture')), () => 'yes']) {
    @Controller()
    class Query {
      @Command('query') query(
        @Slot('x', { match: result as unknown as (text: string) => boolean }) x?: string,
      ): void {
        void x;
      }
    }
    @Module({ controllers: [Query] })
    class Root {}
    const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
    t.after(() => harness.app.close());
    await harness.app.start();
    await harness.dispatch(message('/query x'));
    await tick();
    assert.equal(harness.messages.length, 0);
    assert.equal((harness.errors[0]!.error as FrameworkError).code, 'HANDLER_CONTRACT');
  }
});

await test('input reply failures use the existing send ledger without leaking or duplicating errors', async (t) => {
  @Controller()
  class Query {
    @Command('query') query(@Arg(0, { required: true }) value: string): void {
      void value;
    }
  }
  @Module({ controllers: [Query] })
  class Root {}
  let attempts = 0;
  const harness = await createTestApplication(Root, {
    commands: { invalidInput: 'reply' },
    respond: ({ url }) => {
      if (url.pathname.endsWith('/messages')) {
        attempts++;
        return Response.json({ message: 'denied', code: 123 }, { status: 403 });
      }
      return undefined;
    },
  });
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/query'));
  await tick();
  assert.equal(attempts, 1);
  assert.deepEqual(harness.errors.map(({ error }) => (error as FrameworkError).code).sort(), [
    'PARAMETER_PARSE',
    'QQ_API',
  ]);
  assert.equal(harness.app.snapshot().queue.active, 0);
});

await test('HelpModule is opt-in, per-app, derived from declarations, and aliases resolve to a single entry', async (t) => {
  @Controller()
  class Query {
    @Command('查询', { aliases: ['查'], description: '查询城市信息' }) query(
      @Slot('city', { name: '城市', choices: ['北京'], required: true }) _city: string,
      @Option('page', {
        alias: 'p',
        name: '页码',
        description: '结果页码',
        type: 'integer',
        min: 1,
        max: 10,
        default: 1,
      })
      _page: number,
      @Rest({ name: '备注' }) _rest: string[],
    ): void {
      void [_city, _page, _rest];
    }
  }
  @Module({ controllers: [Query] })
  class NoHelp {}
  @Module({ imports: [HelpModule], controllers: [Query] })
  class Root {}
  const without = await createTestApplication(NoHelp);
  t.after(() => without.app.close());
  await without.app.start();
  assert.equal(await without.dispatch(message('/help')), 'ignored');
  const apps = await Promise.all(
    ['', '!'].map((prefix) => createTestApplication(Root, { commands: { prefix } })),
  );
  for (const [index, harness] of apps.entries()) {
    t.after(() => harness.app.close());
    const prefix = index === 0 ? '' : '!';
    await harness.app.start();
    await harness.dispatch(message(`${prefix}帮助`));
    assert.match(
      harness.messages[0]!.payload.content!,
      new RegExp(`${prefix}查询：查询城市信息`, 'u'),
    );
    assert.equal(harness.messages[0]!.payload.content!.split('查询城市信息').length, 2);
    await harness.dispatch(message(`${prefix}help 查`));
    const details = harness.messages[1]!.payload.content!;
    assert.ok(details.startsWith(`用法：${prefix}查询 <城市·无序> [--page <页码>] [备注...]`));
    for (const part of [
      '--page / -p',
      '默认 1',
      '最小 1',
      '最大 10',
      '结果页码',
      '北京',
      `别名：${prefix}查`,
    ])
      assert.ok(details.includes(part));
    await harness.dispatch(message(`${prefix}help unknown`));
    assert.match(harness.messages[2]!.payload.content!, /未找到/u);
    assert.equal(harness.errors.length, 0);
  }
});

await test('invalid schemas and duplicate definitions fail before provider construction', async () => {
  let constructed = 0;
  const bad: ParameterDecorator[][] = [
    [Rest(), Rest()],
    [Slot('x', { choices: ['a'] }), Slot('x', { choices: ['b'] })],
    [Arg(0), Arg(0, {})],
    [Option('page'), Option('page')],
    [Option('page', { alias: 'p' }), Option('path', { alias: 'p' })],
    [Option('bad name')],
    [Option('1bad')],
    [Option('p', { alias: 'pp' })],
    [Arg(0, { type: 'integer', default: 'x' } as unknown as ArgumentOptions)],
    [Arg(0, { type: 'number', min: NaN })],
    [Arg(0, { type: 'integer', min: 1.5 })],
    [Arg(0, { type: 'number', min: 3, max: 1 })],
    [Arg(0, { type: 'integer', default: 0, min: 1 })],
    [Arg(0, { type: 'number', choices: [1, 1] })],
    [Arg(0, { choices: [] })],
    [Arg(0, { required: true, default: 'x' })],
    [Arg(0, { name: '' })],
    [Option('flag', { type: 'boolean', choices: [true] } as unknown as OptionOptions)],
    [Option('p', { typo: true } as unknown as OptionOptions)],
    [Slot('x', {} as SlotOptions)],
    [Slot('x', { choices: ['a'], default: 'b' })],
    [Slot('x', { choices: ['a', 'a'] })],
    [Slot('x', { match: true } as unknown as SlotOptions)],
    [Slot('bad name', { choices: ['a'] })],
    [Slot('x', { match: (value) => value === 'a', default: 'b' })],
  ];
  for (const parameters of bad) {
    @Controller()
    class Query {
      constructor() {
        constructed++;
      }
      @Command('query') query(): void {}
    }
    parameters.forEach((decorator, index) => decorator(Query.prototype, 'query', index));
    Reflect.defineMetadata(
      'design:paramtypes',
      parameters.map(() => String),
      Query.prototype,
      'query',
    );
    @Module({ controllers: [Query] })
    class Root {}
    await assert.rejects(
      createTestApplication(Root),
      (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
    );
  }
  assert.equal(constructed, 0);
});

await test('new parameter decorators obey event restrictions, inheritance, snapshots and help route conflicts', async (t) => {
  for (const route of [On('C2C_MESSAGE_CREATE'), OnButton('button')]) {
    @Controller()
    class Bad {
      action(@Rest() rest: string[]): void {
        void rest;
      }
    }
    route(Bad.prototype, 'action', Object.getOwnPropertyDescriptor(Bad.prototype, 'action')!);
    @Module({ controllers: [Bad] })
    class BadRoot {}
    await assert.rejects(createTestApplication(BadRoot), /Invalid parameter decorators/u);
  }
  const choices = ['北京'];
  const options: OptionOptions = { type: 'integer', default: 1 };
  @Controller()
  class Base {
    @Command('query') query(
      @Slot('city', { choices }) city: string,
      @Option('page', options) page: number,
    ): string {
      return `${city} ${page}`;
    }
  }
  @Controller()
  class Derived extends Base {}
  choices.push('上海');
  options.default = 2;
  @Module({ controllers: [Derived] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/query 北京'));
  await harness.dispatch(message('/query 上海'));
  await tick();
  assert.equal(harness.messages[0]!.payload.content, '北京 1');
  assert.equal(harness.messages.length, 1);
  assert.equal(harness.errors.length, 1);
  @Controller()
  class Conflict {
    @Command('help') help(): void {}
  }
  @Module({ imports: [HelpModule], controllers: [Conflict] })
  class ConflictRoot {}
  await assert.rejects(createTestApplication(ConflictRoot), /Duplicate/u);
});

await test('invalidInput configuration rejects undeclared values', () => {
  const base = { appId: 'fixture', secret: 'fixture-secret' };
  assert.equal(resolveOptions(base).invalidInput, 'report');
  for (const invalidInput of ['', null, true, 'ignore'])
    assert.throws(
      () => resolveOptions({ ...base, commands: { invalidInput } } as unknown as BotOptions),
      /commands.invalidInput/u,
    );
});
