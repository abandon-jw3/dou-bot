import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  Command,
  Controller,
  ContextValue,
  Cooldown,
  Ctx,
  createContextKey,
  FrameworkError,
  Injectable,
  Module,
  QQApi,
} from '../src/index.js';
import type {
  BotOptions,
  ContextMiddleware,
  ErrorContext,
  MessageContext,
  MiddlewareContext,
  Type,
} from '../src/index.js';
import { Application } from '../src/core/application.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

let next = 0;
async function fixture(t: TestContext, root: Type, options: Partial<BotOptions> = {}) {
  const clock = new FakeClock();
  const errors: { error: Error; context: ErrorContext }[] = [];
  let profiles = 0;
  const app = await Application.create(
    root,
    {
      appId: 'fixture-app',
      secret: 'fixture-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError(error, context) {
        errors.push({ error, context });
      },
      context: { prepareTimeoutMs: 1000, loadTimeoutMs: 1000 },
      execution: { shutdownTimeoutMs: 40 },
      ...options,
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: async (input) => {
        await Promise.resolve();
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('getAppAccessToken'))
          return Response.json({ access_token: 'fixture-token', expires_in: 7200 });
        if (url.endsWith('/users/@me')) {
          profiles++;
          return Response.json({ id: 'fixture-bot' });
        }
        return Response.json({ id: 'sent' });
      },
    },
  );
  await app.start();
  t.after(async () => {
    await app.close().catch(() => {});
    await clock.flush();
    assert.equal(clock.pending, 0);
    assert.equal(app.execution.managedSignals.size, 0);
    assert.equal(app.snapshot().queue.active, 0);
  });
  return {
    app,
    clock,
    errors,
    profiles: () => profiles,
    enqueue: () =>
      app.execution.accept(
        {
          op: 0,
          t: 'C2C_MESSAGE_CREATE',
          d: { id: `context-clock-${++next}`, author: { user_openid: 'user' }, content: '/run' },
        },
        256,
      ),
  };
}

await test('middleware and injection timeouts are classified, do not consume cooldown, and ignore late results', async (t) => {
  for (const phase of ['middleware', 'context'] as const) {
    const key = createContextKey<string>('value');
    const gate = deferred<void>();
    let stalled = true;
    let calls = 0;
    let operationSignal!: AbortSignal;
    let lateWrite: unknown;
    @Injectable()
    class Prepare implements ContextMiddleware {
      async prepare(ctx: MiddlewareContext): Promise<void> {
        if (phase === 'middleware' && stalled) {
          operationSignal = ctx.signal;
          await gate.promise;
          try {
            ctx.state.set(key, 'late');
          } catch (error) {
            lateWrite = error;
          }
          return;
        }
        ctx.state.provide(key, async (signal) => {
          operationSignal = signal;
          if (stalled) await gate.promise;
          return 'ready';
        });
      }
    }
    @Controller()
    class Commands {
      @Command('run')
      @Cooldown({ scope: 'user', durationMs: 500, message: false })
      run(@ContextValue(key) value: string): void {
        assert.equal(value, 'ready');
        calls++;
      }
    }
    @Module({ controllers: [Commands], providers: [Prepare], middlewares: [Prepare] })
    class Root {}
    const f = await fixture(t, Root, { context: { prepareTimeoutMs: 20, loadTimeoutMs: 30 } });
    const first = f.enqueue();
    assert.ok('done' in first);
    await f.clock.flush();
    assert.equal(f.app.execution.managedSignals.has(operationSignal), true);
    await f.clock.advance(phase === 'middleware' ? 20 : 30);
    await first.done;
    assert.equal(calls, 0);
    assert.equal(operationSignal.aborted, true);
    assert.equal(f.errors.length, 1);
    assert.equal(f.errors[0]!.context.phase, phase);
    assert.ok(
      f.errors[0]!.error instanceof FrameworkError && f.errors[0]!.error.code === 'CONTEXT_TIMEOUT',
    );
    gate.resolve();
    await f.clock.flush();
    if (phase === 'middleware')
      assert.ok(lateWrite instanceof FrameworkError && lateWrite.code === 'INVALID_STATE');
    stalled = false;
    const good = f.enqueue();
    if ('done' in good) await good.done;
    assert.equal(calls, 1);
  }
});

await test('shutdown cancels stuck preparation and unawaited loads without extending its deadline', async (t) => {
  for (const mode of ['prepare', 'load'] as const) {
    const key = createContextKey<string>('pending');
    const gate = deferred<string>();
    let entered = false;
    let called = false;
    let signal!: AbortSignal;
    @Injectable()
    class Prepare implements ContextMiddleware {
      async prepare(ctx: MiddlewareContext): Promise<void> {
        if (mode === 'prepare') {
          signal = ctx.signal;
          entered = true;
          await gate.promise;
        } else
          ctx.state.provide(key, (current) => {
            signal = current;
            entered = true;
            return gate.promise;
          });
      }
    }
    @Controller()
    class Commands {
      @Command('run') run(@Ctx() ctx: MessageContext): void {
        called = true;
        // eslint-disable-next-line @typescript-eslint/no-floating-promises -- Verify framework tracking of an unawaited load.
        void ctx.state.get(key);
      }
    }
    @Module({ controllers: [Commands], providers: [Prepare], middlewares: [Prepare] })
    class Root {}
    const f = await fixture(t, Root);
    const event = f.enqueue();
    assert.ok('done' in event);
    await f.clock.flush();
    assert.equal(entered, true);
    const closing = f.app.close().catch(() => {});
    await f.clock.advance(40);
    await closing;
    await event.done;
    assert.equal(signal.aborted, true);
    assert.equal(called, mode === 'load');
    gate.resolve('late');
    await f.clock.flush();
    assert.equal(called, mode === 'load');
    assert.equal(f.app.execution.managedSignals.size, 0);
  }
});

await test('preparation and loader signals authorize managed QQ requests while the application drains', async (t) => {
  for (const mode of ['prepare', 'load'] as const) {
    const key = createContextKey<string>('profile');
    const gate = deferred<void>();
    let waiting = false;
    let invoked = false;
    @Injectable()
    class Prepare implements ContextMiddleware {
      constructor(private readonly api: QQApi) {}
      async prepare(ctx: MiddlewareContext): Promise<void> {
        const read = async (signal: AbortSignal) => {
          waiting = true;
          await gate.promise;
          return (await this.api.getSelf({ signal })).id;
        };
        if (mode === 'prepare') ctx.state.set(key, await read(ctx.signal));
        else ctx.state.provide(key, read);
      }
    }
    @Controller()
    class Commands {
      @Command('run') run(@ContextValue(key) profile: string): void {
        assert.equal(profile, 'fixture-bot');
        invoked = true;
      }
    }
    @Module({ controllers: [Commands], providers: [Prepare], middlewares: [Prepare] })
    class Root {}
    const f = await fixture(t, Root);
    const event = f.enqueue();
    assert.ok('done' in event);
    await f.clock.flush();
    assert.equal(waiting, true);
    assert.equal(f.profiles(), 0);
    const closing = f.app.close();
    await f.clock.flush();
    assert.equal(f.app.status, 'stopping');
    gate.resolve();
    await event.done;
    await closing;
    assert.equal(invoked, true);
    assert.equal(f.profiles(), 1);
    assert.deepEqual(f.errors, []);
  }
});
