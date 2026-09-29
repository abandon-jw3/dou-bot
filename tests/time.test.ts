import test from 'node:test';
import assert from 'node:assert/strict';
import { Command, Controller, Ctx, Injectable, Module } from '../src/index.js';
import type { MessageContext, QQDispatch } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { resolveOptions } from '../src/core/config.js';
import { ErrorReporter } from '../src/core/logging.js';
import { FrameworkError, QQApiError } from '../src/core/errors.js';
import { bounded } from '../src/core/utils.js';
import { HttpRuntime } from '../src/qq/http.js';
import type { FetchPort } from '../src/qq/http.js';
import { TokenManager } from '../src/qq/token.js';
import { HttpQQApi } from '../src/qq/api.js';
import { deferred } from './helpers.js';
import { FakeClock } from './fake-clock.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
const credentials = { appId: 'fixture-app', secret: 'fixture-secret', logger: silent };
const memoryTransport = () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() });
function services(fetcher: FetchPort) {
  const clock = new FakeClock();
  const config = resolveOptions(credentials);
  const reporter = new ErrorReporter(() => [], undefined, 1000, silent, clock);
  const http = new HttpRuntime(config, fetcher, clock);
  const tokens = new TokenManager(config, http, reporter, clock);
  const api = new HttpQQApi(config, http, tokens, clock);
  return {
    clock,
    api,
    http,
    tokens,
    close() {
      tokens.close();
      http.close();
      reporter.close();
    },
  };
}
function event(id: string): QQDispatch {
  return { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { id: 'user' }, content: '/ping' } };
}
function enqueue(app: Application, payload: QQDispatch) {
  return app.execution.accept(payload, Buffer.byteLength(JSON.stringify(payload)));
}

await test('a cancelled API caller stops waiting without cancelling another caller sharing its token', async () => {
  const response = deferred<Response>();
  let requests = 0;
  let tokenSignal: AbortSignal | null | undefined;
  const f = services(async (_input, init) => {
    requests++;
    if (requests === 1) {
      tokenSignal = init?.signal;
      return response.promise;
    }
    return Response.json({ id: 'fixture-bot' });
  });
  try {
    const controller = new AbortController();
    const cancelled = assert.rejects(
      f.api.getSelf({ signal: controller.signal }),
      /caller cancelled/,
    );
    const other = f.api.getSelf();
    controller.abort(new Error('caller cancelled'));
    await cancelled;
    assert.equal(tokenSignal?.aborted, false);
    assert.equal(requests, 1);
    response.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }));
    assert.equal((await other).id, 'fixture-bot');
    assert.equal(requests, 2);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('one HTTP timeout budget covers both shared token acquisition and reading the response body', async () => {
  const tokenResponse = deferred<Response>();
  let requests = 0;
  let cancelledBody = 0;
  let apiSignal: AbortSignal | null | undefined;
  const f = services((_input, init) => {
    requests++;
    if (requests === 1) return tokenResponse.promise;
    apiSignal = init?.signal;
    return Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelledBody++;
          },
        }),
      ),
    );
  });
  try {
    let settled = false;
    const timeout = assert.rejects(
      f.api.getSelf({ timeoutMs: 20 }).finally(() => {
        settled = true;
      }),
      (error: unknown) => error instanceof FrameworkError && error.code === 'TRANSPORT',
    );
    await f.clock.advance(15);
    tokenResponse.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }));
    await f.clock.flush();
    assert.equal(requests, 2);
    await f.clock.advance(4);
    assert.equal(settled, false);
    await f.clock.advance(1);
    await timeout;
    assert.equal(apiSignal?.aborted, true);
    assert.equal(cancelledBody, 1);
    await f.http.drain(f.clock.monotonic() + 1);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('a token wait has its own caller deadline and rejects invalid timeouts before making requests', async () => {
  let requests = 0;
  const f = services(() => {
    requests++;
    return new Promise(() => {});
  });
  try {
    await assert.rejects(f.api.getSelf({ timeoutMs: 0 }), /Invalid request timeout/);
    assert.equal(requests, 0);
    const timeout = assert.rejects(
      f.api.getSelf({ timeoutMs: 15 }),
      /timed out while waiting for a token/,
    );
    await f.clock.advance(15);
    await timeout;
    assert.equal(requests, 1);
  } finally {
    f.close();
  }
  await f.clock.flush();
  assert.equal(f.clock.pending, 0);
});

await test('oversized Content-Length cancels an unread response stream', async () => {
  let cancellations = 0;
  const f = services(() =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancellations++;
          },
        }),
        { headers: { 'content-length': '999999999' } },
      ),
    ),
  );
  try {
    await assert.rejects(f.http.request('https://fixture.invalid', {}), /too large/);
    assert.equal(cancellations, 1);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('an elapsed absolute deadline cannot be bypassed by an already resolved promise', async () => {
  const clock = new FakeClock();
  await assert.rejects(bounded(Promise.resolve('late'), 0, undefined, clock), /Deadline exceeded/);
  assert.equal(clock.pending, 0);
});

await test('a late API error still redacts the exact token used before multiple background refreshes', async () => {
  const response = deferred<Response>();
  let tokens = 0;
  const f = services((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.endsWith('/app/getAppAccessToken')) {
      tokens++;
      return Promise.resolve(
        Response.json({ access_token: `fixture-token-${tokens}`, expires_in: 1 }),
      );
    }
    return response.promise;
  });
  try {
    const pending = assert.rejects(
      f.api.getSelf(),
      (error: unknown) =>
        error instanceof QQApiError &&
        !error.message.includes('fixture-token-1') &&
        !error.traceId?.includes('fixture-token-1'),
    );
    await f.clock.flush();
    await f.clock.advance(1500);
    assert.equal(tokens, 4);
    response.resolve(
      Response.json(
        { code: 401, message: 'rejected fixture-token-1' },
        {
          headers: { 'x-tps-trace-id': 'trace-fixture-token-1' },
        },
      ),
    );
    await pending;
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('dedup TTL starts at completion, protects active work, and does not reset live reply scopes', async () => {
  const clock = new FakeClock();
  const gate = deferred<void>();
  const sequences: number[] = [];
  const receivedAt: number[] = [];
  @Controller()
  class Commands {
    @Command('ping') async ping(@Ctx() context: MessageContext): Promise<string> {
      receivedAt.push(context.receivedAt);
      await gate.promise;
      return 'pong';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      ...credentials,
      execution: { dedupTtlMs: 100, replyScopeTtlMs: 1000 },
    },
    {
      clock,
      transport: memoryTransport,
      fetch: (_input, init) => {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        if (typeof body === 'object' && body !== null && 'msg_seq' in body) {
          sequences.push(Number(body.msg_seq));
          return Promise.resolve(Response.json({ id: 'sent' }));
        }
        return Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }));
      },
    },
  );
  await app.start();
  try {
    const first = enqueue(app, event('same'));
    assert.equal(first.status, 'accepted');
    await clock.advance(500);
    assert.equal(enqueue(app, event('same')).status, 'duplicate');
    gate.resolve();
    if ('done' in first) await first.done;
    clock.jumpWall(86_400_000);
    await clock.advance(99);
    assert.equal(enqueue(app, event('same')).status, 'duplicate');
    await clock.advance(1);
    assert.equal(enqueue(app, event('same')).status, 'accepted');
    await app.execution.idle();
    assert.deepEqual(sequences, [1, 2]);
    await clock.advance(1000);
    assert.equal(enqueue(app, event('same')).status, 'accepted');
    await app.execution.idle();
    assert.deepEqual(sequences, [1, 2, 1]);
    assert.equal(receivedAt[2], clock.wallTime());
  } finally {
    gate.resolve();
    await app.close();
  }
  assert.equal(clock.pending, 0);
});

await test('shutdown shares one absolute deadline across transport, active handlers, and cleanup hooks', async () => {
  const clock = new FakeClock();
  let cleanupAborted: boolean | undefined;
  @Injectable()
  class Resource {
    onModuleDestroy(signal: AbortSignal): void {
      cleanupAborted = signal.aborted;
    }
  }
  @Controller()
  class Commands {
    @Command('ping') ping(): Promise<void> {
      return new Promise(() => {});
    }
  }
  @Module({ providers: [Resource], controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      ...credentials,
      execution: { shutdownTimeoutMs: 100 },
    },
    {
      clock,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({
        start: () => Promise.resolve(),
        stop: () =>
          new Promise((resolve) => {
            clock.timeout(resolve, 70);
          }),
      }),
    },
  );
  await app.start();
  assert.equal(enqueue(app, event('stuck')).status, 'accepted');
  await clock.flush();
  let finished = false;
  const closing = assert.rejects(
    app.close().finally(() => {
      finished = true;
    }),
    (error: unknown) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
  );
  clock.jumpWall(-86_400_000);
  await clock.advance(99);
  assert.equal(finished, false);
  await clock.advance(1);
  await closing;
  assert.equal(app.status, 'stopped');
  assert.equal(cleanupAborted, true);
  assert.deepEqual(app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
  assert.equal(clock.pending, 0);
});

await test('HTTP draining waits for existing requests, rejects new requests, and releases its waiter', async () => {
  const response = deferred<Response>();
  const f = services((input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return url.endsWith('/app/getAppAccessToken')
      ? Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }))
      : response.promise;
  });
  try {
    const request = f.api.getSelf();
    await f.clock.flush();
    f.http.beginDrain();
    let drained = false;
    const draining = f.http.drain(f.clock.monotonic() + 50).then(() => {
      drained = true;
    });
    await assert.rejects(f.api.getSelf(), /no longer accepts/);
    await f.clock.advance(10);
    assert.equal(drained, false);
    response.resolve(Response.json({ id: 'fixture-bot' }));
    await request;
    await draining;
    assert.equal(drained, true);
    assert.equal(f.clock.pending, 1);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('HTTP draining respects its deadline and close cancels the remaining request', async () => {
  const f = services(() => new Promise(() => {}));
  const request = assert.rejects(f.http.request('https://fixture.invalid', {}), /closed/);
  const draining = assert.rejects(f.http.drain(20), /Deadline exceeded/);
  await f.clock.advance(20);
  await draining;
  f.close();
  await request;
  assert.equal(f.clock.pending, 0);
});

await test('capacity waits for reply scope expiry and cancellation removes its timer', async () => {
  const clock = new FakeClock();
  @Controller()
  class Commands {
    @Command('ping') ping(): void {}
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      ...credentials,
      execution: {
        concurrency: 1,
        queueCapacity: 1,
        dedupMaxEntries: 2,
        replyScopeMaxEntries: 2,
        replyScopeTtlMs: 1000,
      },
    },
    {
      clock,
      transport: memoryTransport,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
    },
  );
  await app.start();
  try {
    for (const id of ['one', 'two']) {
      assert.equal(enqueue(app, event(id)).status, 'accepted');
      await app.execution.idle();
    }
    assert.equal(enqueue(app, event('three')).status, 'overloaded');
    const cancelled = new AbortController();
    const rejected = assert.rejects(
      app.execution.waitForCapacity(cancelled.signal),
      /cancelled capacity wait/,
    );
    cancelled.abort(new Error('cancelled capacity wait'));
    await rejected;
    assert.equal(clock.pending, 1);
    let capacity = false;
    const waiting = app.execution.waitForCapacity(new AbortController().signal).then(() => {
      capacity = true;
    });
    await clock.advance(999);
    assert.equal(capacity, false);
    await clock.advance(1);
    await waiting;
    assert.equal(enqueue(app, event('three')).status, 'accepted');
    await app.execution.idle();
  } finally {
    await app.close();
  }
  assert.equal(clock.pending, 0);
});

await test('evicting a completed dedup entry cannot reset its retained reply sequence', async () => {
  const clock = new FakeClock();
  const sent: [unknown, unknown][] = [];
  @Controller()
  class Commands {
    @Command('ping') ping(): string {
      return 'pong';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      ...credentials,
      execution: {
        concurrency: 1,
        queueCapacity: 1,
        dedupMaxEntries: 2,
        replyScopeMaxEntries: 4,
      },
    },
    {
      clock,
      transport: memoryTransport,
      fetch: (_input, init) => {
        const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
        if (typeof body === 'object' && body !== null && 'msg_id' in body && 'msg_seq' in body) {
          sent.push([body.msg_id, body.msg_seq]);
          return Promise.resolve(Response.json({ id: 'sent' }));
        }
        return Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }));
      },
    },
  );
  await app.start();
  try {
    for (const id of ['one', 'two', 'three', 'one']) {
      assert.equal(enqueue(app, event(id)).status, 'accepted');
      await app.execution.idle();
    }
    assert.deepEqual(sent, [
      ['one', 1],
      ['two', 1],
      ['three', 1],
      ['one', 2],
    ]);
  } finally {
    await app.close();
  }
  assert.equal(clock.pending, 0);
});

await test('the shutdown budget starts before synchronous user abort callbacks', async () => {
  class CallbackClock extends FakeClock {
    offset = 0;
    override monotonic(): number {
      return super.monotonic() + this.offset;
    }
  }
  const clock = new CallbackClock();
  let stopDeadline: number | undefined;
  @Injectable()
  class Resource {
    onModuleInit(signal: AbortSignal): void {
      signal.addEventListener(
        'abort',
        () => {
          clock.offset = 80;
        },
        { once: true },
      );
    }
  }
  @Module({ providers: [Resource] })
  class Root {}
  const app = await Application.create(
    Root,
    { ...credentials, execution: { shutdownTimeoutMs: 100 } },
    {
      clock,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      transport: () => ({
        start: () => Promise.resolve(),
        stop: (deadline) => {
          stopDeadline = deadline;
          return Promise.resolve();
        },
      }),
    },
  );
  await app.start();
  await app.close();
  assert.equal(stopDeadline, 100);
  assert.equal(clock.pending, 0);
});
