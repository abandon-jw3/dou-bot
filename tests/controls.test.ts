import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import {
  Arg,
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  Inject,
  Injectable,
  Module,
  On,
  OnButton,
  Slot,
  UseGuards,
} from '../src/index.js';
import type {
  BotOptions,
  ButtonContext,
  CanActivate,
  CooldownOptions,
  GuardContext,
  GuardResult,
  QQDispatch,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { Application } from '../src/core/application.js';
import { CooldownStore } from '../src/core/cooldown.js';
import { resolveOptions } from '../src/core/config.js';
import { deferred, until } from './helpers.js';
import { FakeClock } from './fake-clock.js';

let next = 0;
function message(content: string, user = 'user', group?: string): QQDispatch {
  const id = `controls-${++next}`;
  return group === undefined
    ? { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { user_openid: user }, content } }
    : {
        op: 0,
        t: 'GROUP_MESSAGE_CREATE',
        d: { id, group_openid: group, author: { member_openid: user }, content },
      };
}
function buttonEvent(buttonId = 'choose', user = 'user'): QQDispatch {
  return {
    op: 0,
    t: 'INTERACTION_CREATE',
    id: `event-${++next}`,
    d: {
      id: `interaction-${next}`,
      chat_type: 1,
      group_openid: 'group',
      group_member_openid: user,
      data: { resolved: { button_id: buttonId, button_data: '北京' } },
    },
  };
}

await test('class and method guards resolve injected providers and run in declaration order before argument parsing', async (t) => {
  const calls: string[] = [];
  let instances = 0;
  @Injectable()
  class PermissionService {
    allowed = false;
  }
  @Injectable()
  class First implements CanActivate {
    constructor(readonly permissions: PermissionService) {
      instances++;
    }
    canActivate(ctx: GuardContext): GuardResult {
      calls.push(`first:${ctx.route}:${ctx.kind}`);
      assert.equal(Object.isFrozen(ctx), true);
      assert.equal(Object.isFrozen(ctx.target), true);
      assert.equal('reply' in ctx, false);
      assert.equal('client' in ctx, false);
      assert.equal(ctx.method, 'query');
      return this.permissions.allowed || { allow: false, message: '没有权限' };
    }
  }
  @Injectable()
  class Second implements CanActivate {
    canActivate(): boolean {
      calls.push('second');
      return true;
    }
  }
  @Injectable()
  class Third implements CanActivate {
    canActivate(): boolean {
      calls.push('third');
      return true;
    }
  }
  @Injectable()
  class Fourth implements CanActivate {
    canActivate(): boolean {
      calls.push('fourth');
      return true;
    }
  }
  @Controller()
  @UseGuards(First)
  @UseGuards(Second)
  class Queries {
    @UseGuards(Third, Fourth)
    @Command('query', { aliases: ['q'] })
    query(
      @Slot('city', {
        choices: ['北京'],
        required: true,
        match: () => {
          calls.push('parse');
          return true;
        },
      })
      city: string,
    ): string {
      calls.push('handler');
      return city;
    }
  }
  @Module({ providers: [PermissionService, First, Second, Third, Fourth], controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/q "broken'));
  assert.deepEqual(calls, ['first:query:command']);
  assert.equal(h.messages[0]!.payload.content, '没有权限');
  assert.equal(h.messages[0]!.payload.msg_seq, 1);
  h.app.get(PermissionService).allowed = true;
  await h.dispatch(message('/q 北京'));
  assert.deepEqual(calls.slice(1), [
    'first:query:command',
    'second',
    'third',
    'fourth',
    'parse',
    'handler',
  ]);
  assert.equal(instances, 1);
  assert.equal(h.errors.length, 0);
});

await test('false denies silently, rejection never falls through, and runtime guard faults never become chat messages', async (t) => {
  const state: { result: unknown; throws: boolean } = { result: false, throws: false };
  const reached: string[] = [];
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): GuardResult {
      if (state.throws) throw new Error('private implementation detail');
      return state.result as GuardResult;
    }
  }
  @Injectable()
  class Later implements CanActivate {
    canActivate(): boolean {
      reached.push('guard');
      return true;
    }
  }
  @Controller()
  class Queries {
    @Command('q') @UseGuards(Gate, Later) query(): void {
      reached.push('handler');
    }
  }
  @Module({ providers: [Gate, Later], controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/q'));
  assert.equal(h.messages.length, 0);
  assert.equal(h.errors.length, 0);
  for (const result of [
    undefined,
    1,
    null,
    { allow: true },
    { allow: false, message: 3 },
    { allow: false, message: '' },
    { allow: false, extra: true },
  ]) {
    state.result = result;
    await h.dispatch(message('/q'));
  }
  state.throws = true;
  await h.dispatch(message('/q'));
  await tick();
  assert.equal(h.errors.length, 8);
  assert.ok(
    h.errors.every(
      ({ context }) =>
        context.phase === 'guard' && context.controller === 'Queries' && context.method === 'query',
    ),
  );
  assert.deepEqual(reached, []);
  assert.equal(h.messages.length, 0);
});

await test('guard visibility is checked before construction; invalid factory guards roll back initialization', async () => {
  let created = 0;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): boolean {
      return true;
    }
  }
  @Controller()
  class Queries {
    constructor() {
      created++;
    }
    @Command('q') @UseGuards(Gate) query(): void {}
  }
  @Module({ providers: [Gate] })
  class Hidden {}
  @Module({ imports: [Hidden], controllers: [Queries] })
  class Bad {}
  await assert.rejects(createTestApplication(Bad), /not visible/u);
  assert.equal(created, 0);
  @Module({ providers: [Gate], exports: [Gate] })
  class Shared {}
  @Module({ imports: [Shared], exports: [Gate] })
  class Left {}
  @Module({ imports: [Shared], exports: [Gate] })
  class Right {}
  @Module({ imports: [Left, Right], controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root);
  await h.app.close();
  assert.equal(created, 1);
  let destroyed = false;
  @Module({
    providers: [
      {
        provide: Gate,
        useFactory: () => ({
          onModuleDestroy: () => {
            destroyed = true;
          },
        }),
      },
    ],
    controllers: [Queries],
  })
  class BrokenFactory {}
  await assert.rejects(createTestApplication(BrokenFactory), /canActivate/u);
  assert.equal(destroyed, true);
});

await test('tokens, module-local guard overrides, and async factory injection work without global lookup', async (t) => {
  const TOKEN = Symbol('gate');
  @Injectable()
  class Policy {
    constructor(@Inject('allowed') readonly allowed: boolean) {}
    canActivate(): boolean {
      return this.allowed;
    }
  }
  @Controller()
  class PrivateController {
    @UseGuards(TOKEN) @Command('private') go(): string {
      return 'private';
    }
  }
  @Controller()
  class RootController {
    @UseGuards(TOKEN) @Command('root') go(): string {
      return 'root';
    }
  }
  @Module({
    providers: [
      { provide: 'allowed', useValue: false },
      Policy,
      { provide: TOKEN, inject: [Policy], useFactory: (p: Policy) => Promise.resolve(p) },
    ],
    controllers: [PrivateController],
  })
  class Child {}
  @Module({
    imports: [Child],
    providers: [{ provide: TOKEN, useValue: { canActivate: () => true } }],
    controllers: [RootController],
  })
  class Root {}
  const h = await createTestApplication(Root);
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/private'));
  await h.dispatch(message('/root'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['root'],
  );
});

await test('class guards compose base before derived; overrides replace method policies and raw observers still run', async (t) => {
  const calls: string[] = [];
  const makeGuard = (name: string) => ({
    canActivate: () => {
      calls.push(name);
      return true;
    },
  });
  @Controller()
  @UseGuards('base')
  class Base {
    @Command('inherited') @UseGuards('method') inherited(): void {
      calls.push('inherited');
    }
    @Command('replace') @UseGuards('old') replace(): void {}
    @Command('hidden') hidden(): void {}
  }
  @Controller()
  @UseGuards('derived')
  class Derived extends Base {
    @Command('replace') @UseGuards('new') override replace(): void {
      calls.push('replace');
    }
    override hidden(): void {}
    @On('C2C_MESSAGE_CREATE') observe(): void {
      calls.push('observe');
    }
  }
  @Module({
    providers: ['base', 'derived', 'method', 'new'].map((name) => ({
      provide: name,
      useValue: makeGuard(name),
    })),
    controllers: [Derived],
  })
  class Root {}
  const h = await createTestApplication(Root);
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/inherited'));
  assert.deepEqual(calls, ['observe', 'base', 'derived', 'method', 'inherited']);
  calls.length = 0;
  await h.dispatch(message('/replace'));
  assert.deepEqual(calls, ['observe', 'base', 'derived', 'new', 'replace']);
  calls.length = 0;
  await h.dispatch(message('/hidden'));
  assert.deepEqual(calls, ['observe']);
});

await test('denied and malformed inputs do not consume cooldown; simultaneous aliases allow one invocation', async (t) => {
  let allowed = false;
  let calls = 0;
  const release = deferred<void>();
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): Promise<boolean> {
      return release.promise.then(() => allowed);
    }
  }
  @Controller()
  class Queries {
    @Command('query', { aliases: ['q'] })
    @UseGuards(Gate)
    @Cooldown({ scope: 'user', durationMs: 60000 })
    query(@Arg(0, { required: true, type: 'integer' }) n: number): string {
      calls++;
      return `value:${n}`;
    }
  }
  @Module({ providers: [Gate], controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => h.app.close());
  await h.app.start();
  release.resolve();
  await h.dispatch(message('/query 1'));
  allowed = true;
  await h.dispatch(message('/query bad'));
  assert.equal(calls, 0);
  const payload = message('/query 1');
  await Promise.all([
    h.dispatch(payload),
    h.dispatch(payload),
    ...Array.from({ length: 7 }, () => h.dispatch(message('/q 1'))),
  ]);
  assert.equal(calls, 1);
  assert.equal(h.messages.filter((m) => m.payload.content === 'value:1').length, 1);
  assert.equal(h.messages.filter((m) => m.payload.content?.includes('操作太频繁')).length, 7);
  await tick();
  assert.equal(h.errors.length, 1);
  assert.equal(h.app.snapshot().events.duplicates, 1);
});

await test('cooldown scopes separate users, scenes, sessions, routes, and application instances', async (t) => {
  const calls: string[] = [];
  @Controller()
  class Queries {
    @Command('user') @Cooldown({ scope: 'user', durationMs: 60000, message: false }) user(): void {
      calls.push('user');
    }
    @Command('session')
    @Cooldown({ scope: 'session', durationMs: 60000, message: false })
    session(): void {
      calls.push('session');
    }
    @Command('global')
    @Cooldown({ scope: 'command', durationMs: 60000, message: '稍后再试' })
    global(): void {
      calls.push('global');
    }
  }
  @Module({ controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root);
  t.after(() => h.app.close());
  await h.app.start();
  for (const route of ['user', 'session', 'global']) {
    for (const [user, group] of [
      ['a', 'g1'],
      ['a', 'g1'],
      ['b', 'g1'],
      ['a', 'g2'],
      ['a', undefined],
    ] as const)
      await h.dispatch(message(`/${route}`, user, group));
  }
  assert.deepEqual(calls, [
    'user',
    'user',
    'user',
    'user',
    'session',
    'session',
    'session',
    'global',
  ]);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    Array<string>(4).fill('稍后再试'),
  );
  const other = await createTestApplication(Root);
  t.after(() => other.app.close());
  await other.app.start();
  await other.dispatch(message('/global'));
  assert.equal(calls.at(-1), 'global');
  assert.equal(calls.length, 9);
});

await test('handler failure retains cooldown and full capacity cannot evict another active limit', async (t) => {
  let calls = 0;
  @Controller()
  class Queries {
    @Command('query')
    @Cooldown({ scope: 'user', durationMs: 60000, message: false })
    query(): never {
      calls++;
      throw new Error('fixture failure');
    }
  }
  @Module({ controllers: [Queries] })
  class Root {}
  const h = await createTestApplication(Root, { execution: { cooldownMaxEntries: 1 } });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/query', 'a'));
  await h.dispatch(message('/query', 'b'));
  await h.dispatch(message('/query', 'a'));
  await tick();
  assert.equal(calls, 1);
  assert.equal(h.messages.length, 0);
  assert.equal(h.errors.length, 2);
  assert.equal((h.errors[1]!.error as FrameworkError).code, 'RESOURCE_LIMIT');
  assert.equal(h.errors[1]!.context.phase, 'cooldown');
});

await test('button gates confirm receipt in auto and manual modes, and hints never use interaction IDs as reply references', async (t) => {
  for (const acknowledge of ['auto', 'manual'] as const) {
    let allowed = false;
    let calls = 0;
    @Injectable()
    class Gate implements CanActivate {
      canActivate(ctx: GuardContext): GuardResult {
        assert.equal(ctx.kind, 'button');
        if (ctx.kind === 'button') assert.equal(ctx.data, '北京');
        return allowed || { allow: false, message: '无权限' };
      }
    }
    @Controller()
    class Buttons {
      @OnButton('choose')
      @UseGuards(Gate)
      @Cooldown({ scope: 'user', durationMs: 60000, message: '冷却中' })
      async choose(@Ctx() ctx: ButtonContext): Promise<void> {
        calls++;
        if (acknowledge === 'manual') await ctx.ack();
      }
    }
    @Module({ providers: [Gate], controllers: [Buttons] })
    class Root {}
    const h = await createTestApplication(Root, { interactions: { acknowledge } });
    t.after(() => h.app.close());
    await h.app.start();
    const denied = buttonEvent();
    await h.dispatch(denied);
    await h.dispatch(denied);
    allowed = true;
    await h.dispatch(buttonEvent());
    await h.dispatch(buttonEvent());
    assert.equal(calls, 1);
    assert.equal(h.acknowledgments.length, 3);
    assert.ok(h.acknowledgments.every((ack) => ack.code === 0));
    assert.deepEqual(
      h.messages.map((m) => m.payload.content),
      ['无权限', '冷却中'],
    );
    assert.ok(h.messages.every((m) => !('msg_id' in m.payload) && !('event_id' in m.payload)));
    assert.equal(h.errors.length, 0);
  }
});

await test('blocked manual buttons ACK before a slow hint, and send/guard failures remain tracked', async (t) => {
  const sent = deferred<Response>();
  let hintStarted = false;
  let throws = false;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): GuardResult {
      if (throws) throw new Error('private');
      return { allow: false, message: '拒绝' };
    }
  }
  @Controller()
  class Buttons {
    @OnButton('choose') @UseGuards(Gate) choose(): void {
      assert.fail('denied');
    }
  }
  @Module({ providers: [Gate], controllers: [Buttons] })
  class Root {}
  const h = await createTestApplication(Root, {
    interactions: { acknowledge: 'manual' },
    respond: ({ url }) => {
      if (url.pathname.endsWith('/messages')) {
        hintStarted = true;
        return sent.promise;
      }
      return undefined;
    },
  });
  t.after(() => h.app.close());
  await h.app.start();
  const first = h.dispatch(buttonEvent());
  await until(() => hintStarted && h.acknowledgments.length === 1);
  sent.resolve(Response.json({ code: 123, message: 'denied' }, { status: 403 }));
  await first;
  throws = true;
  await h.dispatch(buttonEvent());
  await tick();
  assert.equal(h.acknowledgments.length, 2);
  assert.equal(h.errors.length, 2);
  assert.equal(h.errors[0]!.context.phase, 'send');
  assert.equal(h.errors[1]!.context.phase, 'guard');
});

await test('cooldown expiry uses monotonic time, pruning uses one timer and shutdown releases all entries', async () => {
  class Root {}
  const clock = new FakeClock();
  const store = new CooldownStore(2, clock);
  const ctx: GuardContext = {
    appId: 'app',
    userId: 'u',
    scene: 'private',
    target: { scene: 'private', userId: 'u' },
    controller: Root,
    method: 'query',
    route: 'q',
    kind: 'command',
    content: '/q',
    attachments: [],
    messageId: 'm',
    eventName: 'C2C_MESSAGE_CREATE',
    receivedAt: clock.wallTime(),
    raw: message('/q'),
    signal: new AbortController().signal,
  };
  const options = { scope: 'user', durationMs: 1500 } as const;
  assert.equal(store.reserve(1, ctx, options), 0);
  assert.equal(store.reserve(2, ctx, options), 0);
  assert.equal(clock.pending, 1);
  clock.jumpWall(1e10);
  await clock.advance(1499);
  assert.equal(store.reserve(1, ctx, options), 1);
  await clock.advance(1);
  assert.equal(store.reserve(3, ctx, options), 0);
  assert.equal(store.size, 1);
  await clock.advance(2000);
  assert.equal(store.size, 0);
  assert.equal(clock.pending, 0);
  assert.equal(store.reserve(1, ctx, options), 0);
  store.close();
  store.close();
  assert.equal(clock.pending, 0);
  assert.equal(store.size, 0);
  assert.throws(() => store.reserve(1, ctx, options), /closed/u);
});

await test('shutdown cancels a stuck async guard and a late allow cannot run a handler or refill cooldown', async () => {
  const pending = deferred<boolean>();
  let signal: AbortSignal | undefined;
  let called = 0;
  let destroyed = false;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(ctx: GuardContext): Promise<boolean> {
      signal = ctx.signal;
      return pending.promise;
    }
    onModuleDestroy(): void {
      destroyed = true;
    }
  }
  @Controller()
  class Queries {
    @Command('query')
    @UseGuards(Gate)
    @Cooldown({ scope: 'command', durationMs: 5000 })
    query(): void {
      called++;
    }
  }
  @Module({ providers: [Gate], controllers: [Queries] })
  class Root {}
  const clock = new FakeClock();
  const app = await Application.create(
    Root,
    {
      appId: 'fixture',
      secret: 'fixture',
      execution: { shutdownTimeoutMs: 50 },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    {
      clock,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    },
  );
  await app.start();
  const event = message('/query');
  const admission = app.execution.accept(event, Buffer.byteLength(JSON.stringify(event)));
  assert.ok('done' in admission);
  await clock.flush();
  const closing = assert.rejects(
    app.close(),
    (error: unknown) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
  );
  await clock.advance(50);
  await closing;
  pending.resolve(true);
  await clock.flush();
  await admission.done;
  assert.equal(signal?.aborted, true);
  assert.equal(destroyed, true);
  assert.equal(called, 0);
  assert.equal(clock.pending, 0);
  assert.equal(app.snapshot().queue.active, 0);
});

await test('invalid control declarations fail during definition or bootstrap', async () => {
  for (const options of [
    null,
    {},
    { scope: 'group', durationMs: 1 },
    { scope: 'user', durationMs: 0 },
    { scope: 'user', durationMs: Infinity },
    { scope: 'user', durationMs: 1.5 },
    { scope: 'user', durationMs: 2147483648 },
    { scope: 'user', durationMs: 100, message: '' },
    { scope: 'user', durationMs: 100, typo: true },
  ])
    assert.throws(() => Cooldown(options as CooldownOptions), /Cooldown/u);
  assert.throws(() => UseGuards(), /tokens/u);
  for (const token of [null, {}, () => true])
    assert.throws(() => UseGuards(token as never), /tokens/u);
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): boolean {
      return true;
    }
  }
  for (const policy of [UseGuards(Gate), Cooldown({ scope: 'user', durationMs: 1000 })]) {
    @Controller()
    class Bad {
      @On('C2C_MESSAGE_CREATE') observe(): void {}
    }
    policy(Bad.prototype, 'observe', Object.getOwnPropertyDescriptor(Bad.prototype, 'observe')!);
    @Module({ controllers: [Bad], providers: [Gate] })
    class Root {}
    await assert.rejects(
      createTestApplication(Root),
      /require @Command, @OnButton or @OnAttachment/u,
    );
  }
  @Controller()
  class Duplicate {
    @Command('q') query(): void {}
  }
  const decorator = Cooldown({ scope: 'user', durationMs: 1000 });
  const descriptor = Object.getOwnPropertyDescriptor(Duplicate.prototype, 'query')!;
  decorator(Duplicate.prototype, 'query', descriptor);
  assert.throws(() => decorator(Duplicate.prototype, 'query', descriptor), /Duplicate/u);
  for (const cooldownMaxEntries of [0, -1, Infinity, '10'])
    assert.throws(
      () =>
        resolveOptions({
          appId: 'a',
          secret: 's',
          execution: { cooldownMaxEntries },
        } as unknown as BotOptions),
      /cooldownMaxEntries/u,
    );
});

await test('normal application close clears active cooldown timers and expiry allows another execution', async () => {
  let called = 0;
  @Controller()
  class Queries {
    @Command('q') @Cooldown({ scope: 'command', durationMs: 100, message: false }) query(): void {
      called++;
    }
  }
  @Module({ controllers: [Queries] })
  class Root {}
  const clock = new FakeClock();
  const app = await Application.create(
    Root,
    {
      appId: 'fixture',
      secret: 'fixture',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    {
      clock,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
    },
  );
  await app.start();
  const dispatch = async () => {
    const event = message('/q');
    const admission = app.execution.accept(event, Buffer.byteLength(JSON.stringify(event)));
    assert.ok('done' in admission);
    await admission.done;
  };
  await dispatch();
  await dispatch();
  assert.equal(called, 1);
  await clock.advance(100);
  await dispatch();
  assert.equal(called, 2);
  assert.equal(clock.pending, 2); // token refresh and one cooldown sweeper
  await app.close();
  assert.equal(clock.pending, 0);
});
