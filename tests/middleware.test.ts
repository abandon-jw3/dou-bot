import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  Arg,
  Args,
  Command,
  Controller,
  ContextValue,
  Cooldown,
  Ctx,
  createContextKey,
  FrameworkError,
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
  UseMiddleware,
  UserId,
} from '../src/index.js';
import type {
  Attachment,
  ButtonContext,
  CanActivate,
  ContextKey,
  ContextMiddleware,
  ContextReader,
  GuardContext,
  MessageContext,
  MiddlewareContext,
  ModuleMetadata,
  QQDispatch,
  QQEventContext,
  Type,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';
import { deferred, until } from './helpers.js';

let next = 0;
function message(content: string, user = 'user', group?: string, image = false): QQDispatch {
  return {
    op: 0,
    t: group === undefined ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `middleware-${++next}`,
      content,
      ...(group === undefined
        ? { author: { user_openid: user } }
        : { group_openid: group, author: { member_openid: user } }),
      ...(image
        ? { attachments: [{ content_type: 'image/png', url: 'https://example.test/a.png' }] }
        : {}),
    },
  };
}
function button(group?: string): QQDispatch {
  return {
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: `middleware-button-${++next}`,
      chat_type: group ? 1 : 2,
      ...(group ? { group_openid: group, group_member_openid: 'user' } : { user_openid: 'user' }),
      data: { resolved: { button_id: 'value' } },
    },
  };
}
async function open(t: TestContext, root: Type, options: TestOptions = {}) {
  const h = await createTestApplication(root, options);
  t.after(() => h.app.close());
  await h.app.start();
  return h;
}
const code = (expected: string) => (error: unknown) =>
  error instanceof FrameworkError && error.code === expected;

await test('a context whose state was never read cannot open a fresh data scope after its handler finished', async (t) => {
  let saved!: MessageContext;
  @Controller()
  class Commands {
    @Command('run') run(@Ctx() ctx: MessageContext): void {
      saved = ctx;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message('/run'));
  await assert.rejects(saved.state.get(createContextKey<string>('late')), code('INVALID_STATE'));
  assert.ok(Object.isFrozen(saved));
  assert.ok(Object.isFrozen(saved.state));
});

await test('module, inherited class and method middleware await in declaration order before guards and binding', async (t) => {
  const calls: string[] = [];
  let instances = 0;
  const value = createContextKey<string>('value');
  @Injectable()
  class Source {
    constructor() {
      instances++;
    }
    label = 'source';
  }
  @Injectable()
  class Prepare implements ContextMiddleware {
    constructor(private readonly source: Source) {}
    async prepare(ctx: MiddlewareContext): Promise<void> {
      calls.push(this.source.label);
      await Promise.resolve();
      ctx.state.provide(value, () => {
        calls.push('load');
        return 'data';
      });
      for (const name of ['reply', 'send', 'ack', 'prompt', 'client'])
        assert.equal(name in ctx, false);
    }
  }
  const middleware = (name: string) => ({
    prepare() {
      calls.push(name);
    },
  });
  @Injectable()
  class Guard implements CanActivate {
    async canActivate(ctx: GuardContext): Promise<boolean> {
      calls.push('guard');
      assert.equal('set' in ctx.state, false);
      assert.equal(await ctx.state.get(value), 'data');
      return true;
    }
  }
  @Controller()
  @UseMiddleware('base')
  class Base {
    @Command('run')
    @UseMiddleware('method-a')
    @UseMiddleware('method-b', 'method-c')
    @UseGuards(Guard)
    run(
      @ContextValue(value) data: string,
      @Slot('word', {
        choices: ['ok'],
        match: () => {
          calls.push('match');
          return true;
        },
      })
      word: string,
    ): string {
      calls.push('handler');
      return `${data}:${word}`;
    }
    @On('C2C_MESSAGE_CREATE') raw(@Ctx() ctx: QQEventContext): void {
      calls.push('raw');
      assert.equal('state' in ctx, false);
    }
  }
  @Controller()
  @UseMiddleware('derived')
  class Derived extends Base {}
  const middlewares = [Prepare];
  @UseMiddleware('module-class')
  @Module({
    imports: [HelpModule],
    controllers: [Derived],
    middlewares,
    providers: [
      Source,
      Prepare,
      Guard,
      ...['base', 'derived', 'method-a', 'method-b', 'method-c', 'module-class'].map((name) => ({
        provide: name,
        useValue: middleware(name),
      })),
    ],
  })
  class Root {}
  middlewares.length = 0;
  const h = await open(t, Root);
  assert.deepEqual(calls, []);
  await h.dispatch(message('/run ok'));
  assert.deepEqual(calls, [
    'raw',
    'source',
    'module-class',
    'base',
    'derived',
    'method-a',
    'method-b',
    'method-c',
    'guard',
    'load',
    'match',
    'handler',
  ]);
  assert.equal(h.messages[0]!.payload.content, 'data:ok');
  assert.equal(instances, 1);
  assert.equal(h.errors.length, 0);
  calls.length = 0;
  await h.dispatch(message('/unknown'));
  assert.deepEqual(calls, ['raw']);
  await h.dispatch(message('/help run'));
  assert.doesNotMatch(h.messages.at(-1)!.payload.content!, /value|context/u);
});

await test('module middleware remains local and exported providers resolve from each controller module', async (t) => {
  const seen: string[] = [];
  const label = createContextKey<string>('module');
  @Injectable()
  class Shared {
    value = 'shared';
  }
  @Injectable()
  class Add implements ContextMiddleware {
    constructor(private readonly source: Shared) {}
    prepare(ctx: MiddlewareContext): void {
      ctx.state.set(label, this.source.value);
      seen.push(ctx.route);
    }
  }
  @Module({ providers: [Shared], exports: [Shared] })
  class Services {}
  @Controller()
  class Imported {
    @Command('child') child(@ContextValue(label) value: string): string {
      return value;
    }
  }
  @Module({ imports: [Services], providers: [Add], middlewares: [Add], controllers: [Imported] })
  class Child {}
  @Controller()
  class Own {
    @Command('own') own(@ContextValue(label) value: string): string {
      return value;
    }
  }
  @Module({
    imports: [Child, Services],
    providers: [
      {
        provide: 'local',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            ctx.state.set(label, 'local');
            seen.push(ctx.route);
          },
        },
      },
    ],
    middlewares: ['local'],
    controllers: [Own],
  })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message('/child'));
  await h.dispatch(message('/own'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['shared', 'local'],
  );
  assert.deepEqual(seen, ['child', 'own']);
  assert.equal(h.errors.length, 0);
});

await test('context injection preserves legacy inputs and isolates concurrent users, scenes and duplicate events', async (t) => {
  const key = createContextKey<{ user: string; group: string | undefined }>('identity');
  const objects: unknown[] = [];
  const readers = new Set<ContextReader>();
  let loads = 0;
  @Injectable()
  class Prepare implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      readers.add(ctx.state);
      ctx.state.provide(key, async () => {
        loads++;
        await Promise.resolve();
        return { user: ctx.userId, group: ctx.scene === 'group' ? ctx.groupId : undefined };
      });
    }
  }
  @Controller()
  class Commands {
    @Command('run') async run(
      @ContextValue(key) value: { user: string; group: string | undefined },
      @Arg(0) first: string,
      @Args() args: string[],
      @Ctx() ctx: MessageContext,
    ): Promise<string> {
      objects.push(value);
      assert.equal(await ctx.state.get(key), value);
      assert.equal(value.user, ctx.userId);
      return JSON.stringify({ ...value, first, args });
    }
  }
  @Module({ controllers: [Commands], providers: [Prepare], middlewares: [Prepare] })
  class Root {}
  const h = await open(t, Root);
  const events = [
    message('/run --unknown extra', 'a'),
    message('/run --unknown extra', 'b'),
    message('/run --unknown extra', 'a', 'group'),
  ];
  await Promise.all(events.map((event) => h.dispatch(event)));
  await h.dispatch(events[0]!);
  assert.equal(loads, 3);
  assert.equal(new Set(objects).size, 3);
  assert.equal(readers.size, 3);
  assert.equal(h.messages.length, 3);
  for (const result of h.messages) {
    const data = JSON.parse(result.payload.content!) as { first: string; args: string[] };
    assert.equal(data.first, '--unknown');
    assert.deepEqual(data.args, ['--unknown', 'extra']);
  }
  assert.equal(h.errors.length, 0);
});

await test('all original parameter checks precede lazy injection and failed middleware or data leaves cooldown free', async (t) => {
  const key = createContextKey<string>('value');
  const calls: string[] = [];
  let failPrepare = false;
  let failLoad = true;
  let allow = true;
  @Injectable()
  class Prepare implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      calls.push('prepare');
      if (failPrepare) throw new Error('prepare failed');
      ctx.state.provide(key, () => {
        calls.push('load');
        if (failLoad) throw new Error('load failed');
        return 'ready';
      });
    }
  }
  @Injectable()
  class Guard implements CanActivate {
    canActivate(): boolean {
      calls.push('guard');
      return allow;
    }
  }
  @Controller()
  class Commands {
    @Command('run')
    @UseGuards(Guard)
    @Cooldown({ scope: 'user', durationMs: 60000, message: false })
    run(
      @ContextValue(key) first: string,
      @Slot('word', {
        choices: ['alias'],
        required: true,
        normalize: () => {
          calls.push('normalize');
          return 'word';
        },
      })
      word: string,
      @Option('page', { type: 'integer', min: 1, default: 1 }) page: number,
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @Rest() rest: string[],
      @UserId() user: string,
      @ContextValue(key) second: string,
    ): string {
      assert.equal(first, second);
      calls.push('handler');
      return `${word}:${page}:${images.length}:${rest.join(',')}:${user}:${first}`;
    }
  }
  @Module({ controllers: [Commands], providers: [Prepare, Guard], middlewares: [Prepare] })
  class Root {}
  const h = await open(t, Root, { commands: { invalidInput: 'reply' } });
  allow = false;
  await h.dispatch(message('/run alias', 'user', undefined, true));
  assert.deepEqual(calls, ['prepare', 'guard']);
  allow = true;
  failPrepare = true;
  await h.dispatch(message('/run alias'));
  failPrepare = false;
  await h.dispatch(message('/run alias --page nope'));
  await h.dispatch(message('/run alias'));
  assert.equal(calls.includes('load'), false);
  await h.dispatch(message('/run alias', 'user', undefined, true));
  assert.equal(calls.filter((call) => call === 'load').length, 1);
  assert.equal(h.messages.length, 2);
  failLoad = false;
  await h.dispatch(message('/run alias note', 'user', undefined, true));
  assert.equal(h.messages.at(-1)!.payload.content, 'word:1:1:note:user:ready');
  await h.dispatch(message('/run alias', 'user', undefined, true));
  assert.equal(calls.filter((call) => call === 'handler').length, 1);
  assert.deepEqual(
    h.errors.map((e) => e.context.phase),
    ['middleware', 'command', 'command', 'context'],
  );
  assert.ok(
    h.errors.every((e) => e.context.controller === 'Commands' && e.context.method === 'run'),
  );
});

await test('handler reads still report caught failures once and do not refund a reserved cooldown', async (t) => {
  const key = createContextKey<string>('failure');
  let runs = 0;
  @Controller()
  class Commands {
    @Command('run')
    @Cooldown({ scope: 'user', durationMs: 60000, message: false })
    async run(@Ctx() ctx: MessageContext): Promise<void> {
      runs++;
      const a = ctx.state.get(key);
      assert.equal(a, ctx.state.get(key));
      await a.catch(() => {});
    }
  }
  @Module({
    controllers: [Commands],
    middlewares: ['data'],
    providers: [
      {
        provide: 'data',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            ctx.state.provide(key, () => Promise.reject(new Error('fixture')));
          },
        },
      },
    ],
  })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message('/run'));
  await h.dispatch(message('/run'));
  assert.equal(runs, 1);
  assert.equal(h.errors.length, 1);
  assert.equal(h.errors[0]!.context.phase, 'context');
});

await test('private and group buttons preserve automatic and manual confirmation on preparation and injection failures', async (t) => {
  const key = createContextKey<string>('value');
  let mode: 'prepare' | 'load' | 'success' = 'prepare';
  @Controller()
  class Buttons {
    @OnButton('value') async button(
      @ContextValue(key) value: string,
      @Ctx() ctx: ButtonContext,
    ): Promise<void> {
      assert.equal(await ctx.state.get(key), value);
      await ctx.ack();
      await ctx.send(value);
    }
  }
  @Module({
    controllers: [Buttons],
    middlewares: ['data'],
    providers: [
      {
        provide: 'data',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            assert.equal(ctx.kind, 'button');
            if (mode === 'prepare') throw new Error('prepare');
            ctx.state.provide(key, () => {
              if (mode === 'load') throw new Error('load');
              return ctx.scene;
            });
          },
        },
      },
    ],
  })
  class Root {}
  for (const acknowledge of ['auto', 'manual'] as const) {
    const h = await open(t, Root, { interactions: { acknowledge } });
    for (const group of [undefined, 'group'])
      for (const value of ['prepare', 'load', 'success'] as const) {
        mode = value;
        await h.dispatch(button(group));
      }
    assert.equal(h.acknowledgments.length, 6);
    assert.ok(h.acknowledgments.every((ack) => ack.code === 0));
    assert.deepEqual(
      h.messages.map((m) => m.payload.content),
      ['private', 'group'],
    );
    assert.deepEqual(
      h.errors.map((e) => e.context.phase),
      ['middleware', 'context', 'middleware', 'context'],
    );
  }
});

await test('attachment handlers have independent state and later handlers continue after preparation or injection failure', async (t) => {
  const key = createContextKey<string>('value');
  const scopes = new Set<ContextReader>();
  @Injectable()
  class Prepare implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      assert.equal(ctx.kind, 'attachment');
      scopes.add(ctx.state);
      if (ctx.method === 'a') throw new Error('prepare');
      ctx.state.provide(key, () => {
        if (ctx.method === 'b') throw new Error('load');
        return ctx.method;
      });
    }
  }
  @Controller()
  class Uploads {
    @OnAttachment() a(@ContextValue(key) value: string): string {
      return value;
    }
    @OnAttachment() b(@ContextValue(key) value: string): string {
      return value;
    }
    @OnAttachment() c(@ContextValue(key) value: string): string {
      return value;
    }
    @OnAttachment() d(@ContextValue(key) value: string): string {
      return value;
    }
  }
  @Module({ controllers: [Uploads], providers: [Prepare], middlewares: [Prepare] })
  class Root {}
  const h = await open(t, Root);
  await h.dispatch(message('', 'user', 'group', true));
  assert.equal(scopes.size, 4);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['c', 'd'],
  );
  assert.deepEqual(
    h.messages.map((m) => m.payload.msg_seq),
    [1, 2],
  );
  assert.deepEqual(
    h.errors.map((e) => e.context.phase),
    ['middleware', 'context'],
  );
});

await test('prompt continuations share the original context scope and a later command creates a fresh scope', async (t) => {
  const key = createContextKey<object>('scope');
  let prepares = 0;
  let loads = 0;
  const seen: object[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const before = await ctx.state.get(key);
      seen.push(before);
      const answer = await ctx.prompt('question');
      assert.equal(answer.status, 'received');
      if (answer.status !== 'received') return;
      assert.equal(answer.message.state, ctx.state);
      assert.equal(await answer.message.state.get(key), before);
      await answer.message.reply('done');
    }
  }
  @Module({
    controllers: [Commands],
    middlewares: ['data'],
    providers: [
      {
        provide: 'data',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            prepares++;
            ctx.state.provide(key, () => {
              loads++;
              return {};
            });
          },
        },
      },
    ],
  })
  class Root {}
  const h = await open(t, Root);
  for (let i = 0; i < 2; i++) {
    const parent = h.enqueue(message('/ask'));
    assert.equal(parent.status, 'accepted');
    await until(() => h.messages.length === 2 * i + 1);
    await h.dispatch(message('/ask'));
    if ('done' in parent) await parent.done;
  }
  assert.equal(prepares, 2);
  assert.equal(loads, 2);
  assert.notEqual(seen[0], seen[1]);
  assert.equal(h.errors.length, 0);
});

await test('an unawaited loader is drained before completion and late reads are rejected', async (t) => {
  const key = createContextKey<string>('pending');
  const pending = deferred<string>();
  let reader!: ContextReader;
  let entered = false;
  @Controller()
  class Commands {
    @Command('run') run(@Ctx() ctx: MessageContext): void {
      reader = ctx.state;
      // eslint-disable-next-line @typescript-eslint/no-floating-promises -- Verify framework tracking of an unawaited load.
      void ctx.state.get(key);
      entered = true;
    }
  }
  @Module({
    controllers: [Commands],
    middlewares: ['data'],
    providers: [
      {
        provide: 'data',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            ctx.state.provide(key, () => pending.promise);
          },
        },
      },
    ],
  })
  class Root {}
  const h = await open(t, Root);
  const result = h.enqueue(message('/run'));
  assert.ok('done' in result);
  let completed = false;
  result.done
    .then(() => {
      completed = true;
    })
    .catch(() => {});
  await until(() => entered);
  assert.equal(completed, false);
  pending.resolve('done');
  await result.done;
  await assert.rejects(reader.get(key), code('INVALID_STATE'));
});

await test('invalid middleware declarations and provider visibility fail before construction or roll back initialized providers', async () => {
  for (const value of [null, false, [false], [{}], ['']])
    assert.throws(
      () => Module({ middlewares: value } as unknown as ModuleMetadata),
      code('CONFIG'),
    );
  assert.throws(() => UseMiddleware(), code('CONFIG'));
  assert.throws(() => UseMiddleware({} as never), code('CONFIG'));
  @Injectable()
  class Valid {
    prepare(): void {}
  }
  let constructed = 0;
  let destroyed = 0;
  @Injectable()
  class Resource {
    constructor() {
      constructed++;
    }
    onModuleDestroy(): void {
      destroyed++;
    }
  }
  @Module({ providers: [Valid] })
  class Hidden {}
  @Module({ imports: [Hidden], middlewares: [Valid], providers: [Resource] })
  class Missing {}
  await assert.rejects(createTestApplication(Missing), code('DEPENDENCY'));
  assert.equal(constructed, 0);
  @Module({
    middlewares: ['bad'],
    providers: [
      Resource,
      {
        provide: 'bad',
        useFactory: async () => {
          await Promise.resolve();
          return {};
        },
      },
    ],
  })
  class Broken {}
  await assert.rejects(createTestApplication(Broken), code('HANDLER_CONTRACT'));
  assert.equal(constructed, 1);
  assert.equal(destroyed, 1);
});

await test('context decorators reject raw observers, constructors and duplicate parameter sources', async () => {
  const key = createContextKey<string>('value');
  assert.throws(() => ContextValue({} as ContextKey<string>), code('CONFIG'));
  @Controller()
  class Duplicate {
    @Command('run') run(@Ctx() ctx: MessageContext): void {
      void ctx;
    }
  }
  assert.throws(() => ContextValue(key)(Duplicate.prototype, 'run', 0), code('CONFIG'));
  assert.throws(() => ContextValue(key)(Duplicate, undefined, 0), code('CONFIG'));
  assert.throws(() => UseMiddleware('x')(Duplicate, 'static', { value() {} }), code('CONFIG'));
  for (const value of [true, false]) {
    @Controller()
    class Invalid {
      @On('C2C_MESSAGE_CREATE') run(@Ctx() ctx: QQEventContext): void {
        void ctx;
      }
    }
    if (value)
      UseMiddleware('x')(
        Invalid.prototype,
        'run',
        Object.getOwnPropertyDescriptor(Invalid.prototype, 'run')!,
      );
    else {
      @Controller()
      class Raw {
        @On('C2C_MESSAGE_CREATE') run(@ContextValue(key) data: string): void {
          void data;
        }
      }
      @Module({ controllers: [Raw] })
      class Root {}
      await assert.rejects(createTestApplication(Root), code('CONFIG'));
      continue;
    }
    @Module({ controllers: [Invalid] })
    class Root {}
    await assert.rejects(createTestApplication(Root), code('CONFIG'));
  }
});

await test('middleware return values cannot deny or reply, and repeated declarations do not silently deduplicate', async (t) => {
  @Controller()
  class Commands {
    @Command('run') run(): string {
      return 'must not run';
    }
  }
  for (const value of [false, 'reply', { allow: false }]) {
    @Module({
      controllers: [Commands],
      middlewares: ['bad'],
      providers: [{ provide: 'bad', useValue: { prepare: () => value } }],
    })
    class Root {}
    const h = await open(t, Root, { commands: { invalidInput: 'reply' } });
    await h.dispatch(message('/run'));
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0]!.context.phase, 'middleware');
    assert.equal(h.messages.length, 0);
  }
  const key = createContextKey<string>('duplicate');
  @Module({
    controllers: [Commands],
    middlewares: ['same', 'same'],
    providers: [
      {
        provide: 'same',
        useValue: {
          prepare(ctx: MiddlewareContext) {
            ctx.state.set(key, 'first');
          },
        },
      },
    ],
  })
  class Twice {}
  const h = await open(t, Twice);
  await h.dispatch(message('/run'));
  assert.equal(h.errors.length, 1);
  assert.ok(code('HANDLER_CONTRACT')(h.errors[0]!.error));
  assert.equal(h.messages.length, 0);
});
