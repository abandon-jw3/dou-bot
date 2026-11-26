import type { SingleBotOptions as BotOptions } from '../src/core/single-options.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Command, Controller, Ctx, Module, OnButton } from '../src/index.js';
import type { MessageContext, QQDispatch, Type } from '../src/index.js';
import { SingleTestApplication as Application } from '../src/testing/single-bot.js';
import type { RuntimePorts } from '../src/testing/single-bot.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

function event(id: string, index = ''): QQDispatch {
  return {
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id,
      group_openid: 'capacity-group',
      author: { member_openid: 'capacity-user' },
      content: '/run',
      message_scene: { ext: [`msg_idx=${index}`] },
    },
  };
}
const enqueue = (app: Application, id: string, bytes = 128, index = '') =>
  app.execution.accept(event(id, index), bytes);
async function create(
  root: Type,
  clock: FakeClock,
  options: Partial<BotOptions> = {},
  ports: RuntimePorts = {},
) {
  const app = await Application.create(
    root,
    {
      appId: 'capacity-fixture',
      secret: 'capacity-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      ...options,
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: () =>
        Promise.resolve(
          Response.json({ access_token: 'fixture-token', expires_in: 7200, id: 'sent' }),
        ),
      ...ports,
    },
  );
  await app.start();
  return app;
}

await test('dedup eviction preserves completion order through churn, expiry and refill', async () => {
  const clock = new FakeClock();
  @Controller()
  class Commands {
    @Command('run') run(): void {}
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await create(Root, clock, {
    execution: { concurrency: 1, queueCapacity: 1, dedupMaxEntries: 3, dedupTtlMs: 100 },
  });
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      for (let index = 0; index < 40; index++) {
        const id = `${cycle}:${index}`;
        assert.equal(enqueue(app, id).status, 'accepted');
        await app.execution.idle();
        const retained = Math.min(index, 2);
        for (let offset = 0; offset <= retained; offset++)
          assert.equal(enqueue(app, `${cycle}:${index - offset}`).status, 'duplicate');
        assert.equal(app.snapshot().capacity.dedup.size, retained + 1);
      }
      // The next admission must not use an exhausted or stale cursor after TTL cleanup.
      await clock.advance(100);
      assert.equal(app.snapshot().capacity.dedup.size, 0);
    }
    assert.equal(app.snapshot().events.accepted, 120);
  } finally {
    await app.close();
  }
  assert.equal(clock.pending, 0);
});

await test('capacity snapshots explain rejection, isolate copies and aggregate queue/processing time', async () => {
  const clock = new FakeClock();
  const gates = [deferred<void>(), deferred<void>()];
  let calls = 0;
  @Controller()
  class Commands {
    @Command('run') async run(): Promise<void> {
      await gates[calls++]!.promise;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await create(Root, clock, { execution: { concurrency: 1, queueCapacity: 1 } });
  try {
    enqueue(app, 'first');
    await clock.advance(30);
    enqueue(app, 'second');
    assert.equal(enqueue(app, 'third').status, 'overloaded');
    assert.equal(enqueue(app, 'oversized', 1048577).status, 'ignored');
    assert.equal(
      app.execution.accept({ op: 0, t: 'C2C_MESSAGE_CREATE', d: {} }, 128).status,
      'ignored',
    );
    await clock.advance(20);
    gates[0]!.resolve();
    await clock.flush();
    await clock.advance(25);
    gates[1]!.resolve();
    await app.execution.idle();
    const snapshot = app.snapshot();
    assert.deepEqual(snapshot.timing, {
      queueWait: { count: 2, totalMs: 20, maxMs: 20 },
      processing: { count: 2, totalMs: 75, maxMs: 50 },
    });
    assert.equal(snapshot.capacity.dedup.size, 2);
    assert.equal(snapshot.capacity.replyScopes.size, 2);
    assert.equal(snapshot.capacity.queueCapacity, 1);
    assert.equal(snapshot.rejections.queueFull, 1);
    assert.equal(snapshot.rejections.invalidEvent, 2);
    assert.equal(
      Object.values(snapshot.rejections).reduce((a, b) => a + b),
      snapshot.events.rejected,
    );
    assert.equal(JSON.stringify(snapshot).includes('capacity-user'), false);
    snapshot.capacity.replyScopes.size = 999;
    snapshot.timing.processing.totalMs = 999;
    snapshot.rejections.queueFull = 999;
    assert.equal(app.snapshot().capacity.replyScopes.size, 2);
    assert.equal(app.snapshot().timing.processing.totalMs, 75);
    assert.equal(app.snapshot().rejections.queueFull, 1);
  } finally {
    gates.forEach((gate) => gate.resolve());
    await app.close();
  }
  assert.equal(app.snapshot().capacity.replyScopes.size, 0);
  assert.equal(app.snapshot().capacity.dedup.size, 0);
  assert.equal(clock.pending, 0);
});

await test('prompt suspension releases active time while resumption contributes a separate queue sample', async () => {
  const clock = new FakeClock();
  @Controller()
  class Commands {
    @Command('run') async run(@Ctx() ctx: MessageContext): Promise<void> {
      await ctx.prompt('next');
      await new Promise<void>((resolve) => clock.timeout(resolve, 40));
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await create(Root, clock);
  try {
    enqueue(app, 'question');
    await clock.advance(5000);
    assert.equal(app.snapshot().prompts.pending, 1);
    enqueue(app, 'answer');
    await clock.advance(40);
    await app.execution.idle();
    assert.deepEqual(app.snapshot().timing, {
      queueWait: { count: 2, totalMs: 0, maxMs: 0 },
      processing: { count: 1, totalMs: 40, maxMs: 40 },
    });
  } finally {
    await app.close();
  }
});

await test('byte, retained reply and active dedup limits report their distinct reasons', async () => {
  const clock = new FakeClock();
  const gate = deferred<void>();
  @Controller()
  class Wait {
    @Command('run') async run(): Promise<void> {
      await gate.promise;
    }
  }
  @Module({ controllers: [Wait] })
  class Waiting {}
  const bytes = await create(Waiting, clock, {
    execution: { maxEventBytes: 128, queueMaxBytes: 128 },
  });
  try {
    enqueue(bytes, 'one');
    assert.equal(enqueue(bytes, 'two').status, 'overloaded');
    assert.equal(bytes.snapshot().rejections.bytesFull, 1);
  } finally {
    gate.resolve();
    await bytes.close();
  }

  @Controller()
  class Prompt {
    @Command('run') async run(@Ctx() ctx: MessageContext): Promise<void> {
      await ctx.prompt('next');
    }
  }
  @Module({ controllers: [Prompt] })
  class Prompting {}
  const prompts = await create(Prompting, clock, {
    execution: {
      concurrency: 1,
      queueCapacity: 1,
      dedupMaxEntries: 2,
      replyScopeMaxEntries: 4,
    },
  });
  try {
    for (const id of ['one', 'two']) {
      const input = event(id);
      (input.d as Record<string, unknown>).group_openid = id;
      assert.equal(prompts.execution.accept(input, 128).status, 'accepted');
      await clock.flush();
    }
    assert.equal(enqueue(prompts, 'three').status, 'overloaded');
    assert.equal(prompts.snapshot().rejections.dedupFull, 1);
  } finally {
    await prompts.close();
  }

  @Controller()
  class Fast {
    @Command('run') run(): void {}
  }
  @Module({ controllers: [Fast] })
  class Ready {}
  const replies = await create(Ready, clock, {
    execution: {
      concurrency: 1,
      queueCapacity: 1,
      dedupMaxEntries: 2,
      replyScopeMaxEntries: 2,
      replyScopeTtlMs: 100,
    },
  });
  try {
    for (const id of ['one', 'two']) {
      enqueue(replies, id);
      await replies.execution.idle();
    }
    assert.equal(enqueue(replies, 'three').status, 'overloaded');
    assert.equal(replies.snapshot().rejections.replyScopesFull, 1);
    await clock.advance(100);
    assert.equal(replies.snapshot().capacity.replyScopes.size, 0);
    assert.equal(enqueue(replies, 'three').status, 'accepted');
    await replies.execution.idle();
  } finally {
    await replies.close();
  }
});

await test('button acknowledgment pressure is counted separately from handler queue pressure', async () => {
  const clock = new FakeClock();
  const gate = deferred<Response>();
  @Controller()
  class Buttons {
    @OnButton('run') run(): void {}
  }
  @Module({ controllers: [Buttons] })
  class Root {}
  const app = await create(
    Root,
    clock,
    { execution: { concurrency: 1 } },
    {
      fetch: (input) =>
        (typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url
        ).includes('/interactions/')
          ? gate.promise
          : Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
    },
  );
  const button = (id: string): QQDispatch => ({
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id,
      chat_type: 1,
      group_openid: 'group',
      group_member_openid: 'user',
      data: { resolved: { button_id: 'run' } },
    },
  });
  try {
    assert.equal(app.execution.accept(button('one'), 128).status, 'accepted');
    await clock.flush();
    assert.equal(app.execution.accept(button('two'), 128).status, 'overloaded');
    assert.equal(app.snapshot().rejections.acknowledgmentsFull, 1);
  } finally {
    gate.resolve(new Response(null, { status: 204 }));
    await app.close();
  }
});

await test('out-of-order completions and reactivated reply scopes retain the correct expiry and sequence', async () => {
  const clock = new FakeClock();
  const gate = deferred<void>();
  const sequences: number[] = [];
  let first = true;
  @Controller()
  class Commands {
    @Command('run') async run(): Promise<string> {
      if (first) {
        first = false;
        await gate.promise;
      }
      return 'done';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await create(
    Root,
    clock,
    { execution: { dedupTtlMs: 100, replyScopeTtlMs: 1000 } },
    {
      fetch: (_input, init) => {
        const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
          msg_seq?: number;
        };
        if (body.msg_seq !== undefined) sequences.push(body.msg_seq);
        return Promise.resolve(
          Response.json({ access_token: 'fixture-token', expires_in: 7200, id: 'sent' }),
        );
      },
    },
  );
  try {
    enqueue(app, 'slow');
    await clock.advance(10);
    const fast = enqueue(app, 'fast');
    if ('done' in fast) await fast.done;
    await clock.advance(100);
    assert.equal(app.snapshot().capacity.dedup.size, 1);
    assert.equal(enqueue(app, 'slow').status, 'duplicate');
    gate.resolve();
    await app.execution.idle();
    await clock.advance(800);
    enqueue(app, 'fast', 128, 'part-two');
    await app.execution.idle();
    await clock.advance(200);
    assert.equal(app.snapshot().capacity.replyScopes.size, 1);
    assert.deepEqual(sequences, [1, 1, 2]);
    await clock.advance(800);
    assert.equal(app.snapshot().capacity.replyScopes.size, 0);
  } finally {
    gate.resolve();
    await app.close();
  }
});

await test('steady expiry examines due records instead of scanning all retained cache entries', async () => {
  const clock = new FakeClock();
  @Controller()
  class Commands {
    @Command('run') run(): void {}
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await create(Root, clock, {
    execution: {
      dedupTtlMs: 10000,
      replyScopeTtlMs: 10000,
      dedupMaxEntries: 2000,
      replyScopeMaxEntries: 2000,
    },
  });
  try {
    for (let index = 0; index < 2000; index++) {
      assert.equal(enqueue(app, `entry-${index}`).status, 'accepted');
      await app.execution.idle();
      await clock.advance(1);
    }
    let expiryReads = 0;
    for (const name of ['dedup', 'scopes']) {
      const entries: unknown = Reflect.get(app.execution, name);
      assert.ok(entries instanceof Map);
      for (const value of entries.values() as MapIterator<{ expiresAt: number }>) {
        let expiry = value.expiresAt;
        Object.defineProperty(value, 'expiresAt', {
          get() {
            expiryReads++;
            return expiry;
          },
          set(next: number) {
            expiry = next;
          },
        });
      }
    }
    await clock.advance(8000);
    assert.equal(enqueue(app, 'new').status, 'accepted');
    await app.execution.idle();
    assert.ok(expiryReads <= 12, `expiry reads: ${expiryReads}`);
    assert.equal(app.snapshot().capacity.replyScopes.size, 2000);
    assert.equal(enqueue(app, 'entry-1').status, 'duplicate');
  } finally {
    await app.close();
  }
});
