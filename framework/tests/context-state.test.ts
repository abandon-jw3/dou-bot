import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { createContextKey, FrameworkError } from '../src/index.js';
import type {
  ContextKey,
  ContextMiddleware,
  ContextOptions,
  ContextWriter,
  GuardContext,
} from '../src/index.js';
import { ContextState } from '../src/core/context-state.js';
import { OperationLedger } from '../src/core/event-task.js';
import { resolveOptions } from '../src/core/config.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

const code = (expected: string) => (error: unknown) =>
  error instanceof FrameworkError && error.code === expected;

await test('a synchronous prepare that exceeds its budget cannot beat the timeout through Promise microtasks', async (t) => {
  const s = scope(t);
  let now = 0;
  s.clock.monotonic = () => now;
  await assert.rejects(
    s.prepare(() => {
      now = 21;
    }),
    code('CONTEXT_TIMEOUT'),
  );
});

await test('first reading a prepare signal after completion cannot create live work and retains a failure reason', async (t) => {
  const s = scope(t);
  let saved!: Parameters<ContextMiddleware['prepare']>[0];
  await s.prepare((ctx) => {
    saved = ctx;
  });
  assert.equal(saved.signal.aborted, true);
  assert.equal(s.signals.size, 0);
  const cause = new Error('prepare failed');
  await assert.rejects(
    s.prepare((ctx) => {
      saved = ctx;
      throw cause;
    }),
    (error) => error === cause,
  );
  assert.equal(saved.signal.reason, cause);
  assert.equal(s.signals.size, 0);
});
function scope(t: TestContext, options: ContextOptions = {}, budget = 32) {
  const clock = new FakeClock();
  const owner = new AbortController();
  const signals = new Set<AbortSignal>();
  const errors = new Set<unknown>();
  const ledger = new OperationLedger(budget, (error) => errors.add(error));
  const data = new ContextState(
    { prepareTimeoutMs: 20, loadTimeoutMs: 40, maxEntries: 64, ...options },
    {
      signal: owner.signal,
      clock,
      managedSignals: signals,
      track: (operation) => ledger.run('context', operation),
      report: (error) => errors.add(error),
    },
  );
  class Controller {}
  const context: GuardContext = {
    appId: 'app',
    eventName: 'C2C_MESSAGE_CREATE',
    receivedAt: 0,
    raw: { op: 0, t: 'C2C_MESSAGE_CREATE', d: {} },
    signal: owner.signal,
    state: data.reader,
    userId: 'user',
    controller: Controller,
    method: 'run',
    route: 'run',
    scene: 'private',
    target: { appId: 'app', scene: 'private', userId: 'user' },
    kind: 'command',
    messageId: 'message',
    content: '/run',
    attachments: [],
  };
  t.after(async () => {
    owner.abort();
    await ledger.sealAndDrain();
    data.close();
    await clock.flush();
    assert.equal(clock.pending, 0);
    assert.equal(signals.size, 0);
  });
  return {
    data,
    clock,
    owner,
    signals,
    ledger,
    errors,
    prepare: (prepare: ContextMiddleware['prepare']) => data.prepare({ prepare }, context),
  };
}

await test('context keys are frozen identities, reject forged tokens and distinguish unset from undefined', async (t) => {
  const s = scope(t);
  for (const name of ['', ' ', '\n', 'a\tb', 'a\u2028b', 1, null])
    assert.throws(() => createContextKey(name as string), code('CONFIG'));
  const first = createContextKey<string | undefined>('same');
  const second = createContextKey<string | undefined>('same');
  assert.ok(Object.isFrozen(first));
  assert.notEqual(first, second);
  await s.prepare((ctx) => ctx.state.set(first, undefined));
  assert.equal(await s.data.reader.get(first), undefined);
  await assert.rejects(s.data.reader.get(second), code('HANDLER_CONTRACT'));
  await assert.rejects(s.data.reader.get({} as ContextKey<string>), code('HANDLER_CONTRACT'));
  assert.equal(s.ledger.budget.count, 0);
});

await test('context values retain identity while frozen facades only grant writes during their own prepare call', async (t) => {
  const s = scope(t);
  const key = createContextKey<{ value: number }>('object');
  const value = { value: 1 };
  let first!: ContextWriter;
  await s.prepare((ctx) => {
    assert.ok(Object.isFrozen(ctx));
    assert.ok(Object.isFrozen(ctx.state));
    first = ctx.state;
    ctx.state.set(key, value);
  });
  await s.prepare(async (ctx) => {
    assert.throws(() => first.set(createContextKey('late'), 1), code('INVALID_STATE'));
    assert.throws(
      () => first.provide(createContextKey('late-loader'), () => 1),
      code('INVALID_STATE'),
    );
    assert.equal(await ctx.state.get(key), value);
  });
  assert.ok(Object.isFrozen(s.data.reader));
  assert.equal('set' in s.data.reader, false);
  assert.equal('provide' in s.data.reader, false);
  assert.equal(await s.data.reader.get(key), value);
  assert.equal(Object.isFrozen(value), false);
  s.data.seal();
  await assert.rejects(s.data.reader.get(key), code('INVALID_STATE'));
  assert.throws(() => first.set(key, value), code('INVALID_STATE'));
});

await test('lazy concurrent readers share one Promise including undefined and never start unused loaders', async (t) => {
  const s = scope(t);
  const key = createContextKey<undefined>('lazy');
  const unused = createContextKey('unused');
  const pending = deferred<undefined>();
  let calls = 0;
  let signal!: AbortSignal;
  await s.prepare((ctx) => {
    ctx.state.provide(key, (current) => {
      signal = current;
      calls++;
      return pending.promise;
    });
    ctx.state.provide(unused, () => {
      throw new Error('unused');
    });
  });
  assert.equal(calls, 0);
  const first = s.data.reader.get(key);
  assert.equal(first, s.data.reader.get(key));
  await s.clock.flush();
  assert.equal(calls, 1);
  assert.equal(s.signals.has(signal), true);
  pending.resolve(undefined);
  assert.equal(await first, undefined);
  assert.equal(first, s.data.reader.get(key));
  assert.equal(signal.aborted, true);
  assert.equal(s.ledger.budget.count, 1);
  assert.equal(s.errors.size, 0);
});

await test('lazy failures are cached and reported once even when nobody awaits the initial read', async (t) => {
  const s = scope(t);
  const key = createContextKey<string>('failure');
  const failure = new Error('fixture');
  let calls = 0;
  await s.prepare((ctx) =>
    ctx.state.provide(key, () => {
      calls++;
      return Promise.reject(failure);
    }),
  );
  const first = s.data.reader.get(key);
  await s.clock.flush();
  assert.equal(first, s.data.reader.get(key));
  await assert.rejects(first, (error) => error === failure);
  assert.equal(calls, 1);
  assert.deepEqual([...s.errors], [failure]);
});

await test('context registration rejects duplicates, async set values and invalid loaders and enforces capacity', async (t) => {
  const s = scope(t, { maxEntries: 2 });
  const key = createContextKey<number>('first');
  await s.prepare((ctx) => {
    ctx.state.set(key, 1);
    assert.throws(() => ctx.state.set(key, 2), code('HANDLER_CONTRACT'));
    assert.throws(() => ctx.state.provide(key, () => 2), code('HANDLER_CONTRACT'));
    assert.throws(
      () => ctx.state.set(createContextKey('promise'), Promise.reject(new Error('invalid set'))),
      code('HANDLER_CONTRACT'),
    );
    assert.throws(
      () => ctx.state.set(createContextKey('thenable'), { then: () => undefined }),
      code('HANDLER_CONTRACT'),
    );
    assert.throws(
      () => ctx.state.provide(key, false as unknown as () => number),
      code('HANDLER_CONTRACT'),
    );
    assert.throws(() => ctx.state.set({} as ContextKey<number>, 2), code('HANDLER_CONTRACT'));
    ctx.state.provide(createContextKey('second'), () => 2);
    assert.throws(() => ctx.state.set(createContextKey('third'), 3), code('RESOURCE_LIMIT'));
  });
  assert.equal(await s.data.reader.get(key), 1);
});

await test('preparation timeout revokes writes and cancels its managed signal without running late results', async (t) => {
  const s = scope(t);
  const pending = deferred<void>();
  let writer!: ContextWriter;
  let signal!: AbortSignal;
  let abortWrite: unknown;
  const preparing = s.prepare((ctx) => {
    writer = ctx.state;
    signal = ctx.signal;
    signal.addEventListener('abort', () => {
      try {
        writer.set(createContextKey('aborted'), 1);
      } catch (error) {
        abortWrite = error;
      }
    });
    return pending.promise;
  });
  const failure = assert.rejects(preparing, code('CONTEXT_TIMEOUT'));
  await s.clock.flush();
  assert.equal(s.signals.has(signal), true);
  s.clock.jumpWall(1000000);
  await s.clock.advance(19);
  assert.equal(signal.aborted, false);
  await s.clock.advance(1);
  await failure;
  assert.equal(signal.aborted, true);
  assert.ok(code('INVALID_STATE')(abortWrite));
  assert.throws(() => writer.set(createContextKey('late'), 1), code('INVALID_STATE'));
  pending.resolve();
  await s.clock.flush();
});

await test('lazy dependency cycles time out with no recursive stack overflow and release timers', async (t) => {
  const s = scope(t);
  const a = createContextKey<number>('a');
  const b = createContextKey<number>('b');
  await s.prepare((ctx) => {
    ctx.state.provide(a, () => ctx.state.get(b));
    ctx.state.provide(b, () => ctx.state.get(a));
  });
  const failure = assert.rejects(s.data.reader.get(a), code('CONTEXT_TIMEOUT'));
  await s.clock.advance(40);
  await failure;
  assert.equal(s.signals.size, 0);
  assert.equal(s.clock.pending, 0);
  assert.equal(s.ledger.budget.count, 2);
});

await test('owner cancellation ends active loads and preparation and rejects late access', async (t) => {
  const s = scope(t);
  const key = createContextKey<number>('pending');
  const pending = deferred<number>();
  let loadSignal!: AbortSignal;
  await s.prepare((ctx) =>
    ctx.state.provide(key, (signal) => {
      loadSignal = signal;
      return pending.promise;
    }),
  );
  const load = s.data.reader.get(key);
  const preparing = s.prepare(() => new Promise<void>(() => {}));
  const failure = new Error('cancel');
  const results = Promise.all([
    assert.rejects(load, (error) => error === failure),
    assert.rejects(preparing, (error) => error === failure),
  ]);
  await s.clock.flush();
  s.owner.abort(failure);
  await results;
  assert.equal(loadSignal.aborted, true);
  await assert.rejects(s.data.reader.get(key), code('INVALID_STATE'));
  await assert.rejects(
    s.prepare(() => {}),
    code('INVALID_STATE'),
  );
  pending.resolve(1);
});

await test('first lazy loads consume the shared operation budget while cached reads do not', async (t) => {
  const s = scope(t, {}, 1);
  const first = createContextKey<number>('first');
  const second = createContextKey<number>('second');
  let calls = 0;
  await s.prepare((ctx) => {
    ctx.state.provide(first, () => 1);
    ctx.state.provide(second, () => {
      calls++;
      return 2;
    });
  });
  assert.equal(await s.data.reader.get(first), 1);
  assert.equal(await s.data.reader.get(first), 1);
  await assert.rejects(s.data.reader.get(second), code('RESOURCE_LIMIT'));
  assert.equal(calls, 0);
  assert.equal(s.ledger.budget.count, 1);
});

await test('context configuration has bounded defaults and rejects invalid options', () => {
  const options = { appId: 'fixture', secret: 'fixture-secret' };
  assert.deepEqual(resolveOptions(options).context, {
    prepareTimeoutMs: 10000,
    loadTimeoutMs: 10000,
    maxEntries: 64,
  });
  for (const key of ['prepareTimeoutMs', 'loadTimeoutMs', 'maxEntries'])
    for (const value of [0, -1, 1.5, Infinity, NaN, 2147483648, '1', null])
      assert.throws(
        () => resolveOptions({ ...options, context: { [key]: value } }),
        code('CONFIG'),
      );
  assert.throws(
    () => resolveOptions({ ...options, context: { unknown: 1 } as ContextOptions }),
    code('CONFIG'),
  );
  assert.equal(Object.isFrozen(resolveOptions(options).context), true);
});
