import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { Module, Controller, Command, OnButton, Ctx, image } from '../src/index.js';
import type { MessageContext, ButtonContext, BotTarget } from '../src/index.js';
import { FrameworkError } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { OutboundQueue } from '../src/core/outbound.js';
import { ErrorReporter } from '../src/core/logging.js';
import { createMultiTestApplication } from '../src/testing/index.js';
import { createFixtures } from '../src/testing/fixtures.js';
import { MemoryPersistence } from '../src/testing/memory-persistence.js';
import { deferred, until } from './helpers.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };

await test('provider declarations reject misspelled options and non-array injection lists before startup', async () => {
  const recipes = [
    { provide: 'value', useFactory: () => undefined, injects: ['missing'] },
    { provide: 'value', useFactory: () => undefined, inject: 1 },
  ];
  for (const recipe of recipes) {
    @Module({ providers: [recipe as never] })
    class Root {}
    await assert.rejects(
      createMultiTestApplication(Root),
      (error: unknown) => error instanceof FrameworkError && error.code === 'DEPENDENCY',
    );
  }
});

await test('message and button targets remain serializable addresses when clients are allocated lazily', async () => {
  const targets: BotTarget[] = [];
  const collect = (ctx: MessageContext | ButtonContext) => {
    targets.push(structuredClone(ctx.target));
    assert.ok(Object.isFrozen(ctx.target));
    assert.equal(ctx.client, ctx.client);
    assert.equal(ctx.client.api, ctx.client.api);
  };
  @Controller()
  class Commands {
    @Command('target') target(@Ctx() ctx: MessageContext) {
      collect(ctx);
    }
    @OnButton('target') button(@Ctx() ctx: ButtonContext) {
      collect(ctx);
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root);
  await h.app.start();
  try {
    for (const group of [false, true]) {
      await h.dispatch('offline-app', {
        op: 0,
        t: group ? 'GROUP_AT_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
        d: { id: `message-${group}`, content: '/target', group_openid: 'g', author: { id: 'u' } },
      });
      await h.dispatch('offline-app', {
        op: 0,
        t: 'INTERACTION_CREATE',
        d: {
          id: `button-${group}`,
          chat_type: group ? 1 : 2,
          group_openid: 'g',
          user_openid: 'u',
          group_member_openid: 'u',
          data: { resolved: { button_id: 'target' } },
        },
      });
    }
    assert.deepEqual(targets, [
      { scene: 'private', userId: 'u', appId: 'offline-app' },
      { scene: 'private', userId: 'u', appId: 'offline-app' },
      { scene: 'group', groupId: 'g', appId: 'offline-app' },
      { scene: 'group', groupId: 'g', appId: 'offline-app' },
    ]);
    assert.equal(h.errors.length, 0);
  } finally {
    await h.app.close();
  }
});

await test("bulk cancellation releases pending messages and preserves another account's progress", async () => {
  const queue = new OutboundQueue({ concurrency: 1, queueCapacity: 4000, queueMaxBytes: 8000 });
  const gate = deferred<void>();
  const seen: number[] = [];
  const first = queue.run('a', 1, () => gate.promise);
  const signals = Array.from({ length: 3000 }, () => new AbortController());
  const pending = signals.map((source, i) =>
    queue.run(
      'a',
      1,
      () => {
        seen.push(i);
        return Promise.resolve();
      },
      source.signal,
    ),
  );
  const other = queue.run('b', 1, () => {
    assert.equal(seen.length, 0);
    return Promise.resolve();
  });
  try {
    for (let i = 1; i < signals.length; i += 2) signals[i]!.abort(new Error('cancelled'));
    assert.equal(queue.snapshot().pending, 1501);
    gate.resolve();
    await Promise.all([first, other]);
    const settled = await Promise.allSettled(pending);
    await queue.idle();
    assert.equal(settled.filter((x) => x.status === 'rejected').length, 1500);
    assert.deepEqual(
      seen,
      Array.from({ length: 1500 }, (_, i) => i * 2),
    );
    assert.equal(queue.snapshot().retainedBytes, 0);
    assert.equal(queue.snapshot().active, 0);
    assert.equal(queue.snapshot().pending, 0);
  } finally {
    gate.resolve();
    queue.close();
    await Promise.allSettled(pending);
  }
});

await test('disabled debug logging skips inspection and enabled logging redacts one secret snapshot', () => {
  let inspections = 0;
  let inventories = 0;
  const off = new ErrorReporter(() => {
    inventories++;
    return ['secret-value'];
  });
  off.logger.debug('ignored', {
    get expensive() {
      inspections++;
      return 'secret-value';
    },
  });
  assert.equal(inspections, 0);
  assert.equal(inventories, 0);
  off.close();
  const captured: { message: string; fields?: Readonly<Record<string, unknown>> }[] = [];
  const on = new ErrorReporter(
    () => {
      inventories++;
      return ['secret-value'];
    },
    undefined,
    1000,
    {
      ...silent,
      info: (message, fields) =>
        captured.push({ message, ...(fields === undefined ? {} : { fields }) }),
    },
  );
  const error = new Error('secret-value');
  error.name = 'secret-value';
  on.logger.info('secret-value', {
    nested: { id: 'secret-value' },
    error,
    password: 'unlisted-password',
  });
  assert.equal(inventories, 1);
  assert.deepEqual(captured, [
    {
      message: '[redacted]',
      fields: {
        nested: { id: '[redacted]' },
        error: { name: '[redacted]', message: '[redacted]' },
        password: '[redacted]',
      },
    },
  ]);
  on.close();
});

await test('the managed API preserves the default interaction acknowledgment code', async () => {
  @Module({})
  class Root {}
  const h = await createMultiTestApplication(Root);
  await h.app.start();
  try {
    await h.app.bots.get('offline-app').client.api.acknowledgeInteraction('default');
    await h.app.bots
      .get('offline-app')
      .client.api.acknowledgeInteraction('explicit-undefined', undefined);
    assert.deepEqual(h.acknowledgments, [
      { interactionId: 'default', code: 0 },
      { interactionId: 'explicit-undefined', code: 0 },
    ]);
    assert.equal(h.errors.length, 0);
  } finally {
    await h.app.close();
  }
});

await test('a cached background API and send method follow the same account after restart', async () => {
  @Module({})
  class Root {}
  const h = await createMultiTestApplication(Root);
  await h.app.start();
  try {
    const bot = h.app.bots.get('offline-app');
    const api = bot.client.api;
    // The public facade deliberately supports retaining a callable across a runtime replacement.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const send = bot.client.sendMessage;
    await bot.stop();
    await bot.start();
    await api.getSelf();
    await send({ scene: 'group', groupId: 'g' }, 'after restart');
    assert.equal(h.messages[0]?.payload.content, 'after restart');
  } finally {
    await h.app.close();
  }
});

await test('a failed start finishes its cleanup before another start can replace the account runtime', async () => {
  @Module({})
  class Root {}
  let builds = 0;
  let starts = 0;
  const cleanup = deferred<void>();
  const fixture = createFixtures({});
  const app = await Application.create(
    Root,
    {
      database: { host: 'localhost', user: 'offline', database: 'offline', password: '' },
      bots: [{ appId: 'a', secret: 'fixture' }],
      logger: silent,
    },
    {
      persistence: new MemoryPersistence(),
      fetch: fixture.fetcher,
      transport: () => {
        const generation = ++builds;
        return {
          start: () => {
            starts++;
            return generation === 2 ? Promise.reject(new Error('start failed')) : Promise.resolve();
          },
          stop: () => (generation === 2 ? cleanup.promise : Promise.resolve()),
        };
      },
    },
  );
  await app.start();
  const bot = app.bots.get('a');
  await bot.stop();
  const first = bot.start().catch((error: unknown) => error);
  let second: Promise<unknown> | undefined;
  try {
    await until(() => bot.status === 'failed');
    second = bot.start().catch((error: unknown) => error);
    await tick();
    assert.equal(starts, 2, 'a retry must not overlap the cleanup of the current attempt');
    cleanup.resolve();
    assert.ok((await first) instanceof Error);
    assert.ok((await second) instanceof Error);
    await bot.start();
    assert.equal(starts, 3);
    await bot.client.sendMessage({ scene: 'group', groupId: 'g' }, 'recovered');
  } finally {
    cleanup.resolve();
    await first;
    await second;
    await app.close();
  }
});

await test('ordered image replies retain the bytes captured at each call while earlier sends are pending', async () => {
  const first = deferred<Response>();
  const uploads: string[] = [];
  let waiting = false;
  @Controller()
  class Commands {
    @Command('images') async images(@Ctx() ctx: MessageContext) {
      const bytes = new Uint8Array([1, 2, 3]);
      const a = ctx.reply(image(bytes));
      bytes[0] = 4;
      const b = ctx.reply(image(bytes));
      bytes.fill(9);
      await Promise.all([a, b]);
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    respond: (r) => {
      if (r.url.pathname.endsWith('/files')) {
        uploads.push((r.body as { file_data: string }).file_data);
        if (uploads.length === 1) {
          waiting = true;
          return first.promise;
        }
      }
      return undefined;
    },
  });
  await h.app.start();
  try {
    const processing = h.dispatch('offline-app', {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: 'images', content: '/images', author: { user_openid: 'u' } },
    });
    await until(() => waiting);
    first.resolve(Response.json({ file_info: 'first', ttl: 60 }));
    await processing;
    assert.deepEqual(
      uploads.map((x) => [...Buffer.from(x, 'base64')]),
      [
        [1, 2, 3],
        [4, 2, 3],
      ],
    );
    assert.deepEqual(
      h.messages.map((m) => m.payload.msg_seq),
      [1, 2],
    );
  } finally {
    first.resolve(Response.json({ file_info: 'first', ttl: 60 }));
    await h.app.close();
  }
});

await test('an overloaded account waits for shared capacity and wakes when another account frees it', async () => {
  const gate = deferred<void>();
  @Controller()
  class Commands {
    @Command('hold') async hold() {
      await gate.promise;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots: [{ appId: 'a' }, { appId: 'b' }],
    execution: { concurrency: 1, queueCapacity: 1 },
  });
  await h.app.start();
  assert.ok(h.app instanceof Application);
  const app = h.app;
  let ready = false;
  const cancellation = new AbortController();
  try {
    const event = (id: string) => ({
      op: 0 as const,
      t: 'C2C_MESSAGE_CREATE',
      d: { id, content: '/hold', author: { user_openid: 'u' } },
    });
    h.enqueue('a', event('one'));
    h.enqueue('a', event('two'));
    assert.equal(h.enqueue('b', event('three')).status, 'overloaded');
    const waiting = app
      .runtime('b')
      .execution.waitForCapacity(cancellation.signal)
      .then(() => {
        ready = true;
      });
    await tick();
    assert.equal(ready, false);
    gate.resolve();
    await h.flush();
    await waiting;
    assert.equal(ready, true);
  } finally {
    cancellation.abort();
    gate.resolve();
    await h.app.close();
  }
});

await test('background acknowledgments remain managed across token refresh and application drain', async () => {
  @Module({})
  class Root {}
  let tokenCalls = 0;
  const token = deferred<Response>();
  const first = deferred<Response>();
  const seen: string[] = [];
  const fixture = createFixtures({
    respond: (r) => {
      if (r.url.pathname.endsWith('/app/getAppAccessToken')) {
        tokenCalls++;
        if (tokenCalls > 1) return token.promise;
      }
      if (r.url.pathname.startsWith('/interactions/')) {
        seen.push(r.url.pathname);
        if (seen.length === 1) return first.promise;
      }
      return undefined;
    },
  });
  const app = await Application.create(
    Root,
    {
      database: { host: 'localhost', user: 'offline', database: 'offline', password: '' },
      bots: [{ appId: 'a', secret: 'fixture' }],
      logger: silent,
    },
    {
      persistence: new MemoryPersistence(),
      fetch: fixture.fetcher,
      transport: () => ({ start: async () => {}, stop: async () => {} }),
    },
  );
  await app.start();
  const api = app.bots.get('a').client.api;
  const source = new AbortController();
  const a = api.acknowledgeInteraction('first', 0, { signal: source.signal });
  await until(() => seen.length === 1);
  app.runtime('a').tokens.invalidate();
  const b = api.acknowledgeInteraction('second', 0, { signal: source.signal });
  const bResult = b.then(
    () => undefined,
    (error: unknown) => error,
  );
  await until(() => tokenCalls === 2);
  const closing = app.close();
  try {
    first.resolve(new Response(null, { status: 204 }));
    await a;
    token.resolve(Response.json({ access_token: 'refreshed', expires_in: 7200 }));
    assert.equal(await bResult, undefined);
    await closing;
    assert.deepEqual(seen, ['/interactions/first', '/interactions/second']);
  } finally {
    first.resolve(new Response(null, { status: 204 }));
    token.resolve(Response.json({ access_token: 'refreshed', expires_in: 7200 }));
    await bResult;
    await closing.catch(() => {});
  }
});

await test('module and command configuration reject misspelled fields supplied through variables', () => {
  const moduleOptions = { providers: [], controllerss: [] };
  const commandOptions = { description: 'test', alias: ['p'] };
  assert.throws(() => Module(moduleOptions), /Unknown.*controllerss/);
  assert.throws(() => Command('ping', commandOptions), /Unknown.*alias/);
});

await test('module declarations snapshot provider recipes while preserving useValue identity', async () => {
  const value = { id: 'original' };
  const tokens = ['value'];
  const recipe = { provide: 'copy', inject: tokens, useFactory: (item: unknown) => item };
  const moduleOptions = {
    providers: [{ provide: 'value', useValue: value }, recipe],
    exports: ['copy'],
  };
  @Module(moduleOptions)
  class Root {}
  tokens[0] = 'missing';
  recipe.useFactory = () => ({ id: 'changed' });
  const h = await createMultiTestApplication(Root);
  await h.app.start();
  try {
    assert.equal(h.app.get('copy'), value);
  } finally {
    await h.app.close();
  }
});
