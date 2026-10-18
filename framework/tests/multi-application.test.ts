import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import {
  AppFactory,
  BotManager,
  MessageSender,
  Database,
  GroupRoutes,
  Module,
  Controller,
  Injectable,
  Command,
  Ctx,
  Cooldown,
  OnAttachment,
  OnButton,
  FrameworkError,
  image,
} from '../src/index.js';
import type {
  AppOptions,
  MessageContext,
  ButtonContext,
  QQDispatch,
  SendTarget,
} from '../src/index.js';
import { Application } from '../src/core/application.js';
import { createMultiTestApplication } from '../src/testing/index.js';
import { MemoryPersistence } from '../src/testing/memory-persistence.js';
import { createFixtures } from '../src/testing/fixtures.js';
import { OutboundQueue, outboundSettings } from '../src/core/outbound.js';
import { FakeClock } from './fake-clock.js';
import { deferred, until, qqServer, serve } from './helpers.js';
import { createPrivateKey, sign } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';

const bots = [{ appId: 'a' }, { appId: 'b' }];
const silent = { debug() {}, info() {}, warn() {}, error() {} };
const config = (): AppOptions => ({
  database: { host: '127.0.0.1', user: 'test', password: '', database: 'test' },
  bots: bots.map((bot) => ({ ...bot, secret: 'fixture-secret' })),
  logger: silent,
});
const privateMessage = (id: string, content: string): QQDispatch => ({
  op: 0,
  t: 'C2C_MESSAGE_CREATE',
  d: { id, content, author: { user_openid: 'same-user' } },
});
const groupMessage = (id: string, group: string, content = '/ping'): QQDispatch => ({
  op: 0,
  t: 'GROUP_MESSAGE_CREATE',
  d: { id, content, group_openid: group, author: { member_openid: 'same-user' } },
});
const code = (name: string) => (error: unknown) =>
  error instanceof FrameworkError && error.code === name;

await test('create validates without constructing providers; one shared service/pool and ordered application hooks', async () => {
  const calls: string[] = [];
  @Injectable()
  class Shared {
    constructor(
      readonly database: Database,
      readonly bots: BotManager,
    ) {
      calls.push('construct');
    }
    onModuleInit() {
      calls.push('init');
    }
    onApplicationReady() {
      assert.equal(this.bots.list().length, 2);
      calls.push('ready');
    }
    onApplicationStopping() {
      calls.push('stopping');
    }
    onModuleDestroy() {
      calls.push('destroy');
    }
  }
  @Controller()
  class Commands {
    constructor(readonly shared: Shared) {}
    @Command('ping') ping() {
      return 'pong';
    }
  }
  @Module({ providers: [Shared], controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  assert.deepEqual(calls, []);
  assert.throws(() => h.app.get(Shared), code('INVALID_STATE'));
  await h.app.start();
  const shared = h.app.get(Shared);
  assert.equal(shared.database, h.app.get(Database));
  await Promise.all([
    h.dispatch('a', privateMessage('same', '/ping')),
    h.dispatch('b', privateMessage('same', '/ping')),
  ]);
  assert.deepEqual(h.messages.map((m) => m.appId).sort(), ['a', 'b']);
  await h.app.bots.get('a').stop();
  assert.equal(h.app.status, 'degraded');
  await h.app.bots.get('a').start();
  assert.equal(h.app.status, 'running');
  assert.equal(h.app.get(Shared), shared);
  await h.app.close();
  assert.deepEqual(calls, ['construct', 'init', 'ready', 'stopping', 'destroy']);
  await assert.rejects(h.app.bots.get('a').start(), code('INVALID_STATE'));
  await assert.rejects(h.app.start(), code('INVALID_STATE'));
});

await test('configuration rejects missing database, duplicate bots, ambiguous paths and account-local listener settings', async () => {
  @Module({})
  class Root {}
  const invalid: unknown[] = [
    { bots: [] },
    { ...config(), database: undefined },
    { ...config(), bots: [] },
    { ...config(), bots: [config().bots[0], config().bots[0]] },
    { ...config(), bots: [{ appId: 'a', secret: 'x', transport: { type: 'webhook', port: 1 } }] },
    {
      ...config(),
      bots: [
        { appId: 'a', secret: 'x', transport: { type: 'webhook', path: '/same' } },
        { appId: 'b', secret: 'y', transport: { type: 'webhook', path: '/same' } },
      ],
    },
  ];
  for (const options of invalid)
    await assert.rejects(AppFactory.create(Root, options as AppOptions), code('CONFIG'));
  // A shared provider cannot accidentally capture the first account's client.
  const { QQClient } = await import('../src/index.js');
  @Module({ providers: [{ provide: 'bad', inject: [QQClient], useFactory: () => ({}) }] })
  class Bad {}
  await assert.rejects(AppFactory.create(Bad, config()), code('DEPENDENCY'));
});

await test('same user/event strings are independent across accounts, cooldowns and scoped clients', async () => {
  const saved: MessageContext[] = [];
  @Controller()
  class Commands {
    @Cooldown({ scope: 'command', durationMs: 60000, message: false })
    @Command('ping')
    ping(@Ctx() ctx: MessageContext) {
      saved.push(ctx);
      return ctx.appId;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  await h.app.start();
  try {
    await assert.rejects(
      h.app.bots
        .get('a')
        .client.sendMessage({ scene: 'group', groupId: 'g', appId: 'b' } as SendTarget, 'wrong'),
      code('HANDLER_CONTRACT'),
    );
    await h.dispatch('a', privateMessage('same', '/ping'));
    await h.dispatch('b', privateMessage('same', '/ping'));
    assert.equal(await h.dispatch('a', privateMessage('same', '/ping')), 'duplicate');
    await h.dispatch('a', privateMessage('next', '/ping'));
    assert.deepEqual(
      saved.map((ctx) => ctx.target.appId),
      ['a', 'b'],
    );
    assert.equal(h.messages.length, 2);
    for (const ctx of saved) await assert.rejects(ctx.client.getSelf(), code('INVALID_STATE'));
    const media = await h.app.bots
      .get('a')
      .client.uploadImage({ scene: 'group', groupId: 'g' }, new Uint8Array([1]));
    await assert.rejects(
      h.app.bots.get('b').client.sendMessage({ scene: 'group', groupId: 'g' }, image(media)),
      code('HANDLER_CONTRACT'),
    );
    await h.app.bots.get('a').stop();
    await h.app.bots.get('a').start();
    await assert.rejects(saved[0]!.client.getSelf(), code('INVALID_STATE'));
    await h.dispatch('a', privateMessage('same', '/ping'));
    assert.equal(h.messages.length, 3);
  } finally {
    await h.app.close();
  }
});

await test('group routing uses account-scoped OpenIDs, explicit preferences and no cross-bot failover', async () => {
  @Controller()
  class Commands {
    @Command('ping') ping() {}
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  await h.app.start();
  const sender = h.app.get(MessageSender);
  const routes = h.app.get(GroupRoutes);
  try {
    await h.dispatch('a', groupMessage('learn', 'group-a'));
    await h.dispatch('b', groupMessage('learn', 'group-b'));
    await sender.sendMessage({ scene: 'group', groupId: 'group-a' }, 'a');
    await sender.sendMessage({ scene: 'group', groupId: 'group-b' }, 'b');
    assert.deepEqual(
      h.messages.map((m) => [m.appId, m.target]),
      [
        ['a', { scene: 'group', groupId: 'group-a' }],
        ['b', { scene: 'group', groupId: 'group-b' }],
      ],
    );
    await assert.rejects(
      sender.sendMessage({ scene: 'group', groupId: 'unknown' }, 'x'),
      code('ROUTE_NOT_FOUND'),
    );
    await routes.bind({ scene: 'group', groupId: 'same-opaque-value', appId: 'a' });
    await h.dispatch('b', groupMessage('other', 'same-opaque-value'));
    assert.equal((await routes.resolve('same-opaque-value')).appId, 'a');
    await routes.unbind('same-opaque-value');
    await assert.rejects(routes.resolve('same-opaque-value'), code('ROUTE_AMBIGUOUS'));
    await routes.bind({ scene: 'group', groupId: 'same-opaque-value', appId: 'b' });
    await h.app.bots.get('b').stop();
    await assert.rejects(
      sender.sendMessage({ scene: 'group', groupId: 'same-opaque-value' }, 'x'),
      code('BOT_UNAVAILABLE'),
    );
    await sender.sendMessage(
      { scene: 'group', groupId: 'same-opaque-value', appId: 'a' },
      'explicit',
    );
    await assert.rejects(
      sender.sendMessage({ scene: 'private', userId: 'user' } as SendTarget, 'x'),
      code('HANDLER_CONTRACT'),
    );
    assert.equal(h.messages.at(-1)?.appId, 'a');
  } finally {
    await h.app.close();
  }
});

await test('shared inbound permits are fair and prompts release/reacquire them without cross-account capture', async () => {
  const gate = deferred<void>();
  const order: string[] = [];
  @Controller()
  class Commands {
    @Command('hold') async hold(@Ctx() ctx: MessageContext) {
      order.push(ctx.appId);
      await gate.promise;
    }
    @Command('ask') async ask(@Ctx() ctx: MessageContext) {
      const r = await ctx.prompt('question');
      if (r.status === 'received') await r.message.reply(ctx.appId + ':' + r.message.content);
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots,
    execution: { concurrency: 1, queueCapacity: 3 },
  });
  await h.app.start();
  try {
    h.enqueue('a', privateMessage('1', '/hold'));
    h.enqueue('a', privateMessage('2', '/hold'));
    h.enqueue('a', privateMessage('3', '/hold'));
    h.enqueue('b', privateMessage('1', '/hold'));
    assert.equal(h.enqueue('b', privateMessage('overflow', '/hold')).status, 'overloaded');
    await tick();
    assert.deepEqual(order, ['a']);
    gate.resolve();
    await h.flush();
    assert.deepEqual(order, ['a', 'b', 'a', 'a']);
    h.enqueue('a', privateMessage('ask', '/ask'));
    h.enqueue('b', privateMessage('ask', '/ask'));
    await until(() => h.messages.length === 2);
    assert.equal(h.app.snapshot().inbound.active, 0);
    h.enqueue('b', privateMessage('answer', 'from-b'));
    h.enqueue('a', privateMessage('answer', 'from-a'));
    await h.flush();
    assert.deepEqual(
      h.messages
        .slice(2)
        .map((m) => [m.appId, m.payload.content])
        .sort(),
      [
        ['a', 'a:from-a'],
        ['b', 'b:from-b'],
      ],
    );
  } finally {
    gate.resolve();
    await h.app.close();
  }
});

await test('outbound queue is bounded, fair, snapshots input and cancels queued work', async () => {
  const gate = deferred<Response>();
  const entered = deferred<void>();
  @Module({})
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots,
    outbound: { concurrency: 1, queueCapacity: 3 },
    respond: (r) => {
      if (r.body && (r.body as { content?: string }).content === 'hold') {
        entered.resolve();
        return gate.promise;
      }
      return undefined;
    },
  });
  await h.app.start();
  try {
    const first = h.app.bots.get('a').client.sendMessage({ scene: 'group', groupId: 'g' }, 'hold');
    await entered.promise;
    const input = { kind: 'text' as const, content: 'original' };
    const a = h.app.bots.get('a').client.sendMessage({ scene: 'group', groupId: 'g' }, input);
    input.content = 'mutated';
    const abort = new AbortController();
    const cancelled = h.app.bots
      .get('a')
      .client.sendMessage({ scene: 'group', groupId: 'g' }, 'cancel', { signal: abort.signal });
    const b = h.app.bots.get('b').client.sendMessage({ scene: 'group', groupId: 'g' }, 'b');
    await assert.rejects(
      h.app.bots.get('b').client.sendMessage({ scene: 'group', groupId: 'g' }, 'overflow'),
      code('QUEUE_FULL'),
    );
    abort.abort(new Error('cancelled'));
    await assert.rejects(cancelled, /cancelled/);
    gate.resolve(Response.json({ id: 'first' }));
    await Promise.all([first, a, b]);
    assert.deepEqual(
      h.messages.map((m) => m.payload.content),
      ['b', 'original'],
    );
    assert.equal(h.app.snapshot().outbound.retainedBytes, 0);
  } finally {
    gate.resolve(Response.json({ id: 'first' }));
    await h.app.close();
  }
});

await test('queued route lookup counts against outbound capacity before database resolution', async () => {
  @Module({})
  class Root {}
  const storage = new MemoryPersistence();
  const gate = deferred<string | undefined>();
  storage.lookup = async () => ({ candidates: [], explicit: (await gate.promise)! });
  const fixture = createFixtures({});
  const app = await Application.create(
    Root,
    { ...config(), outbound: { concurrency: 1, queueCapacity: 1 } },
    {
      persistence: storage,
      fetch: fixture.fetcher,
      transport: () => ({ start: async () => {}, stop: async () => {} }),
    },
  );
  await app.start();
  const sender = app.get(MessageSender);
  const one = sender.sendMessage({ scene: 'group', groupId: 'g' }, 'one').catch(() => {});
  const two = sender.sendMessage({ scene: 'group', groupId: 'g' }, 'two').catch(() => {});
  await assert.rejects(
    sender.sendMessage({ scene: 'group', groupId: 'g' }, 'three'),
    code('QUEUE_FULL'),
  );
  gate.resolve('a');
  await Promise.all([one, two]);
  await app.close();
});

await test('partial startup failure is isolated, recovery and manual stop preserve shared providers', async () => {
  @Module({})
  class Root {}
  let failing = true;
  const fixture = createFixtures({});
  const app = await Application.create(Root, config(), {
    persistence: new MemoryPersistence(),
    accounts: (id) => ({
      fetch: fixture.fetcher,
      transport: () => ({
        start: () =>
          id === 'b' && failing ? Promise.reject(new Error('failed-b')) : Promise.resolve(),
        stop: async () => {},
      }),
    }),
  });
  await app.start();
  assert.equal(app.status, 'degraded');
  assert.equal(app.bots.get('a').status, 'running');
  assert.equal(app.bots.get('b').status, 'failed');
  failing = false;
  await app.bots.get('b').start();
  assert.equal(app.status, 'running');
  await app.bots.get('a').stop();
  await tick();
  assert.equal(app.bots.get('a').status, 'stopped');
  await app
    .get(MessageSender)
    .sendMessage({ appId: 'b', scene: 'group', groupId: 'b-group' }, 'still-running');
  await app.close();
});

await test('database learning failure never guesses a route and explicit context replies remain usable', async () => {
  @Controller()
  class Commands {
    @Command('ping') ping() {
      return 'pong';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const storage = new MemoryPersistence();
  storage.observe = () => Promise.reject(new Error('fixture storage failure'));
  const fixture = createFixtures({});
  const errors: string[] = [];
  const app = await Application.create(
    Root,
    {
      ...config(),
      onError: (_e, c) => {
        errors.push(c.phase);
      },
    },
    {
      persistence: storage,
      fetch: fixture.fetcher,
      transport: () => ({ start: async () => {}, stop: async () => {} }),
    },
  );
  await app.start();
  try {
    const event = groupMessage('g', 'g');
    const result = app.runtime('a').execution.accept(event, 256);
    assert.ok('done' in result);
    await result.done;
    assert.equal(fixture.messages[0]?.payload.content, 'pong');
    assert.ok(errors.includes('routing'));
    await assert.rejects(
      app.get(MessageSender).sendMessage({ scene: 'group', groupId: 'g' }, 'x'),
      code('ROUTE_NOT_FOUND'),
    );
  } finally {
    await app.close();
  }
});

await test('mixed WS/Webhook routes verify path, header and signature for the configured account', async () => {
  @Controller()
  class Commands {
    @Command('ping') ping(@Ctx() ctx: MessageContext) {
      return ctx.appId;
    }
    @OnButton('press') async press(@Ctx() ctx: ButtonContext) {
      await ctx.send(ctx.appId);
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const backend = await qqServer();
  const secret = '0123456789abcdef';
  const app = await Application.create(
    Root,
    {
      ...config(),
      bots: [
        {
          appId: 'a',
          secret,
          api: { baseUrl: backend.url, tokenEndpoint: backend.url + '/app/getAppAccessToken' },
          transport: { type: 'ws' },
        },
        {
          appId: 'b',
          secret,
          api: { baseUrl: backend.url, tokenEndpoint: backend.url + '/app/getAppAccessToken' },
          transport: { type: 'webhook' },
        },
      ],
      webhook: { listen: false },
    },
    { persistence: new MemoryPersistence() },
  );
  const host = await serve(app.webhookHandler());
  await app.start();
  try {
    backend.sockets[0]!.send(JSON.stringify({ ...privateMessage('same', '/ping'), s: 2 }));
    const body = JSON.stringify(privateMessage('same', '/ping'));
    const ts = String(Math.floor(Date.now() / 1000));
    const key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from('302e020100300506032b657004220420', 'hex'),
        Buffer.from(secret.repeat(2)),
      ]),
      format: 'der',
      type: 'pkcs8',
    });
    const headers = {
      'x-bot-appid': 'b',
      'x-signature-timestamp': ts,
      'x-signature-ed25519': sign(null, Buffer.from(ts + body), key).toString('hex'),
    };
    assert.equal((await fetch(host.url + '/qq/b', { method: 'POST', headers, body })).status, 200);
    assert.equal(
      (
        await fetch(host.url + '/qq/b', {
          method: 'POST',
          headers: { ...headers, 'x-bot-appid': 'a' },
          body,
        })
      ).status,
      403,
    );
    assert.equal((await fetch(host.url + '/qq/a', { method: 'POST', headers, body })).status, 404);
    await until(() => backend.messages.length === 2);
    assert.deepEqual(backend.messages.map((m) => m.content).sort(), ['a', 'b']);
    await app.bots.get('a').stop();
    assert.equal((await fetch(host.url + '/qq/b', { method: 'POST', headers, body })).status, 200);
  } finally {
    await app.close();
    await host.close();
    await backend.close();
  }
});

await test('one external WS provider fans out through account-scoped learned group addresses', async () => {
  const source = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve) => source.once('listening', resolve));
  let connections = 0;
  source.on('connection', () => connections++);
  @Injectable()
  class Events {
    private socket?: WebSocket;
    constructor(private readonly sender: MessageSender) {}
    async onApplicationReady(signal: AbortSignal) {
      const address = source.address();
      assert.ok(typeof address === 'object' && address);
      const socket = new WebSocket(`ws://127.0.0.1:${address.port}`);
      this.socket = socket;
      socket.on('error', () => {});
      socket.on('message', () => {
        for (const groupId of ['ga', 'gb'])
          this.sender.sendMessage({ scene: 'group', groupId }, 'push', { signal }).catch(() => {});
      });
      await new Promise<void>((resolve) => socket.once('open', resolve));
    }
    onApplicationStopping() {
      this.socket?.terminate();
    }
  }
  @Controller()
  class Commands {
    @Command('ping') ping() {}
  }
  @Module({ providers: [Events], controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  await h.app.start();
  try {
    await h.dispatch('a', groupMessage('a', 'ga'));
    await h.dispatch('b', groupMessage('b', 'gb'));
    assert.equal(connections, 1);
    for (const socket of source.clients) socket.send('fixture');
    await until(() => h.messages.length === 2);
    assert.deepEqual(h.messages.map((m) => m.appId).sort(), ['a', 'b']);
  } finally {
    await h.app.close();
    for (const socket of source.clients) socket.terminate();
    await new Promise<void>((resolve) => source.close(() => resolve()));
  }
});

await test('outbound cancellation and shutdown release queued and uncooperative active operations under a controlled clock', async () => {
  const clock = new FakeClock();
  const queue = new OutboundQueue(outboundSettings({ concurrency: 1, queueCapacity: 1 }), clock);
  const first = queue.run('a', 100, () => new Promise(() => {}));
  const second = queue.run('b', 100, () => Promise.resolve());
  const failure = assert.rejects(first, code('INVALID_STATE'));
  const pending = assert.rejects(second, code('INVALID_STATE'));
  queue.close();
  await clock.flush();
  await Promise.all([failure, pending]);
  await queue.idle();
  assert.equal(queue.snapshot().active, 0);
  assert.equal(queue.snapshot().pending, 0);
  assert.equal(queue.snapshot().retainedBytes, 0);
  assert.equal(clock.pending, 0);
});

await test('attachment invocations share the provider but keep context state independent across bots', async () => {
  const calls: string[] = [];
  @Controller()
  class Commands {
    @OnAttachment() first(@Ctx() ctx: MessageContext) {
      calls.push(ctx.appId + ':first');
      throw new Error('expected failure');
    }
    @OnAttachment() second(@Ctx() ctx: MessageContext) {
      calls.push(ctx.appId + ':second');
      return 'done';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  await h.app.start();
  const event: QQDispatch = {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'file',
      author: { user_openid: 'u' },
      attachments: [{ url: 'https://example.com/file', content_type: 'file' }],
    },
  };
  try {
    await Promise.all([h.dispatch('a', event), h.dispatch('b', event)]);
    assert.equal(h.messages.length, 2);
    assert.equal(calls.length, 4);
    assert.equal(h.errors.length, 2);
  } finally {
    await h.app.close();
  }
});

await test('unawaited background client failures are tracked and reported with the sending account', async () => {
  @Module({})
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots,
    respond: (r) =>
      r.url.pathname.endsWith('/messages')
        ? Response.json({ code: 42, message: 'expected-send-error' })
        : undefined,
  });
  await h.app.start();
  // eslint-disable-next-line @typescript-eslint/no-floating-promises -- Exercise SDK ownership when the caller omits await.
  h.app.bots.get('b').client.sendMessage({ scene: 'group', groupId: 'gb' }, 'failure');
  await until(() => h.errors.length === 1);
  assert.equal(h.errors[0]?.context.appId, 'b');
  assert.equal(h.errors[0]?.context.phase, 'send');
  await h.app.close();
});

await test('closing during an async factory disposes its late resource and never opens a bot', async () => {
  const clock = new FakeClock();
  const gate = deferred<object>();
  let destroyed = 0;
  let started = 0;
  @Module({ providers: [{ provide: 'late', useFactory: () => gate.promise }] })
  class Root {}
  const fixture = createFixtures({});
  const app = await Application.create(
    Root,
    { ...config(), execution: { shutdownTimeoutMs: 20 } },
    {
      clock,
      persistence: new MemoryPersistence(),
      fetch: fixture.fetcher,
      transport: () => ({
        start: () => {
          started++;
          return Promise.resolve();
        },
        stop: async () => {},
      }),
    },
  );
  const starting = app.start().catch(() => {});
  await clock.flush();
  const closing = app.close().catch(() => {});
  await clock.advance(20);
  await closing;
  gate.resolve({
    onModuleDestroy() {
      destroyed++;
    },
  });
  await clock.flush();
  await starting;
  assert.equal(destroyed, 1);
  assert.equal(started, 0);
  assert.equal(clock.pending, 0);
});

await test('shutdown drains accepted explicit and routed sends while rejecting new background work', async () => {
  @Module({})
  class Root {}
  const storage = new MemoryPersistence();
  const lookup = deferred<string | undefined>();
  storage.lookup = async () => ({ candidates: [], explicit: (await lookup.promise)! });
  const fixture = createFixtures({});
  const app = await Application.create(Root, config(), {
    persistence: storage,
    fetch: fixture.fetcher,
    transport: () => ({ start: async () => {}, stop: async () => {} }),
  });
  await app.start();
  const sending = app.get(MessageSender).sendMessage({ scene: 'group', groupId: 'ga' }, 'accepted');
  await tick();
  const closing = app.close();
  await assert.rejects(
    app.bots.get('a').client.sendMessage({ scene: 'group', groupId: 'ga' }, 'late'),
    code('INVALID_STATE'),
  );
  lookup.resolve('a');
  await sending;
  await closing;
  assert.equal(fixture.messages[0]?.payload.content, 'accepted');
  assert.equal(app.snapshot().outbound.retainedBytes, 0);
});

await test('scoped clients snapshot message input synchronously, including custom cancellation signals', async () => {
  @Controller()
  class Commands {
    @Command('send') async send(@Ctx() ctx: MessageContext) {
      const input = { kind: 'text' as const, content: 'original' };
      const cancellation = new AbortController();
      const pending = ctx.client.sendMessage(ctx.target, input, { signal: cancellation.signal });
      input.content = 'changed';
      await pending;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, { bots });
  await h.app.start();
  try {
    await h.dispatch('a', privateMessage('snapshot', '/send'));
    assert.equal(h.messages[0]?.payload.content, 'original');
  } finally {
    await h.app.close();
  }
});

await test('application configuration is snapshotted at create invocation and rejects sparse bot lists', async () => {
  @Module({})
  class Root {}
  const fixture = createFixtures({});
  const raw = config();
  const creating = Application.create(Root, raw, {
    persistence: new MemoryPersistence(),
    fetch: fixture.fetcher,
    transport: () => ({ start: async () => {}, stop: async () => {} }),
  });
  raw.bots[0]!.appId = 'mutated';
  raw.database.schema = 'mutated';
  const app = await creating;
  try {
    await app.start();
    assert.equal(app.bots.get('a').appId, 'a');
    assert.equal(app.get(Database).schema, 'offline');
    assert.throws(() => app.bots.get('mutated'), code('BOT_UNAVAILABLE'));
  } finally {
    await app.close();
  }
  await assert.rejects(
    AppFactory.create(Root, { ...config(), bots: new Array(1) as AppOptions['bots'] }),
    code('CONFIG'),
  );
});

await test('cross-account send diagnostics retain the source signal and selected destination', async () => {
  @Controller()
  class Commands {
    constructor(private readonly sender: MessageSender) {}
    @Command('cross') async cross(@Ctx() ctx: MessageContext) {
      await this.sender
        .sendMessage({ appId: 'b', scene: 'group', groupId: 'gb' }, 'fail', { signal: ctx.signal })
        .catch(() => {});
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots,
    respond: (r) =>
      r.url.pathname.endsWith('/messages')
        ? Response.json({ code: 42, message: 'expected' })
        : undefined,
  });
  await h.app.start();
  try {
    await h.dispatch('a', privateMessage('cross', '/cross'));
    assert.equal(h.errors.length, 1);
    assert.equal(h.errors[0]?.context.appId, 'b');
    assert.equal(h.errors[0]?.context.sourceAppId, 'a');
  } finally {
    await h.app.close();
  }
});

await test('shared Webhook bind failure isolates those accounts and can recover without restarting WS or services', async () => {
  const occupied = await serve((_request, response) => response.end());
  const port = Number(new URL(occupied.url).port);
  const fixture = createFixtures({});
  let constructed = 0;
  @Injectable()
  class Shared {
    constructor() {
      constructed++;
    }
  }
  @Module({ providers: [Shared] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      ...config(),
      bots: [
        { appId: 'a', secret: 'x' },
        { appId: 'b', secret: 'y', transport: { type: 'webhook' } },
      ],
      webhook: { port },
    },
    {
      persistence: new MemoryPersistence(),
      fetch: fixture.fetcher,
      accounts: (id) =>
        id === 'a'
          ? {
              fetch: fixture.fetcher,
              transport: () => ({ start: async () => {}, stop: async () => {} }),
            }
          : { fetch: fixture.fetcher },
    },
  );
  try {
    await app.start();
    assert.equal(app.status, 'degraded');
    assert.equal(app.bots.get('a').status, 'running');
    assert.equal(app.bots.get('b').status, 'failed');
    await occupied.close();
    await Promise.all([app.bots.get('b').start(), app.bots.get('b').start()]);
    assert.equal(app.status, 'running');
    assert.equal(constructed, 1);
    const reply = await fetch(`http://127.0.0.1:${port}/qq/b`, { method: 'POST', body: '{}' });
    assert.equal(reply.status, 403);
    await app
      .get(MessageSender)
      .sendMessage({ appId: 'a', scene: 'group', groupId: 'ga' }, 'still running');
  } finally {
    await app.close();
    if (occupied.server.listening) await occupied.close();
  }
});
