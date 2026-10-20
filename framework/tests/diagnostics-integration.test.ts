import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Arg,
  Command,
  ContextValue,
  Controller,
  Ctx,
  Images,
  Injectable,
  GroupRoutes,
  MessageSender,
  Module,
  Slot,
  UseGuards,
  UseMiddleware,
  createContextKey,
} from '../src/index.js';
import type {
  Attachment,
  CanActivate,
  ContextMiddleware,
  GuardContext,
  MessageContext,
  MiddlewareContext,
} from '../src/index.js';
import { createMultiTestApplication } from '../src/testing/index.js';
import { SingleTestApplication } from '../src/testing/single-bot.js';
import { HttpRuntime } from '../src/qq/http.js';
import { resolveOptions } from '../src/core/config.js';
import { Diagnostics, diagnosticsSettings } from '../src/diagnostics/observer.js';
import { FakeClock } from './fake-clock.js';
import { deferred, until } from './helpers.js';

const privateKey = createContextKey<number>('PRIVATE-KEY-NAME');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

await test('input-error replies remain inside handler total time', async () => {
  const clock = new FakeClock();
  const response = deferred<Response>();
  let sending = false;
  @Controller()
  class Commands {
    @Command('required') required(@Arg(0, { required: true }) _value: string): void {
      void _value;
      assert.fail('Missing input must not invoke the handler');
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await SingleTestApplication.create(
    Root,
    {
      appId: 'a',
      secret: 'fixture',
      logger: quiet,
      commands: { invalidInput: 'reply' },
      diagnostics: { enabled: true },
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: (url) => {
        if (typeof url === 'string' && url.includes('getAppAccessToken'))
          return Promise.resolve(Response.json({ access_token: 'fixture', expires_in: 7200 }));
        sending = true;
        return response.promise;
      },
    },
  );
  await app.start();
  try {
    const result = app.execution.accept(
      {
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id: 'm',
          content: '/required',
          author: { user_openid: 'user' },
        },
      },
      128,
    );
    assert.ok('done' in result);
    await until(() => sending);
    assert.equal(
      app.diagnostics.snapshot().metrics.find((m) => m.stage === 'handler.total')!.active,
      1,
    );
    await clock.advance(20);
    response.resolve(Response.json({ id: 'hint' }));
    await result.done;
    const metrics = app.diagnostics.snapshot().metrics;
    assert.equal(metrics.find((m) => m.stage === 'handler.bind')!.outcomes.error, 1);
    assert.equal(metrics.find((m) => m.stage === 'handler.total')!.totalMs, 20);
    assert.equal(metrics.find((m) => m.stage === 'handler.total')!.outcomes.error, 1);
  } finally {
    response.resolve(Response.json({ id: 'cleanup' }));
    await app.close();
  }
});

await test('diagnostic capacity exhaustion never rejects business work', async () => {
  @Controller()
  class Commands {
    @Command('ok') ok(): string {
      return 'ok';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    diagnostics: {
      enabled: true,
      traceSampleRate: 1,
      maxSeries: 1,
      maxActiveSpans: 1,
      maxPendingSpans: 1,
    },
  });
  await h.app.start();
  try {
    for (let id = 0; id < 10; id++)
      assert.equal(
        await h.dispatch('offline-app', {
          op: 0,
          t: 'C2C_MESSAGE_CREATE',
          d: {
            id: String(id),
            content: '/ok',
            author: { user_openid: 'user' },
          },
        }),
        'accepted',
      );
    assert.equal(h.messages.length, 10);
    assert.equal(h.errors.length, 0);
    assert.ok(h.app.diagnostics.snapshot().droppedMeasurements > 0);
    assert.ok(h.app.diagnostics.snapshot().droppedSpans > 0);
  } finally {
    await h.app.close();
  }
});

await test('a resolved cross-account send keeps source correlation but attributes HTTP to the sending account', async () => {
  @Controller()
  class Forward {
    constructor(private readonly sender: MessageSender) {}
    @Command('forward') async forward(@Ctx() ctx: MessageContext): Promise<void> {
      await this.sender.sendMessage({ scene: 'group', groupId: 'private-target' }, 'forwarded', {
        signal: ctx.signal,
      });
    }
  }
  @Module({ controllers: [Forward] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots: [{ appId: 'a' }, { appId: 'b' }],
    diagnostics: { enabled: true, traceSampleRate: 1 },
  });
  await h.app.start();
  try {
    await h.app.get(GroupRoutes).bind({ appId: 'b', scene: 'group', groupId: 'private-target' });
    await h.dispatch('a', {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'source',
        content: '/forward',
        author: { user_openid: 'user' },
      },
    });
    assert.equal(h.messages[0]!.appId, 'b');
    const spans = h.app.diagnostics.takeSpans();
    const handler = spans.find((s) => s.stage === 'handler.invoke')!;
    const http = spans.find((s) => s.stage === 'qq.http' && s.operation === 'message')!;
    assert.equal(handler.appId, 'a');
    assert.equal(http.appId, 'b');
    assert.equal(http.traceId, handler.traceId);
    const queue = spans.find((s) => s.stage === 'outbound.queue')!;
    assert.equal(queue.appId, undefined);
    assert.ok(spans.some((s) => s.stage === 'route.lookup' && s.traceId === handler.traceId));
    assert.equal(JSON.stringify(spans).includes('private-target'), false);
  } finally {
    await h.app.close();
  }
});

await test('diagnostics correlates middleware, guards, binding, lazy state and sends without recording event data', async () => {
  let loads = 0;
  @Injectable()
  class Prepare implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      ctx.state.provide(privateKey, async () => {
        loads++;
        await Promise.resolve();
        return 7;
      });
    }
  }
  @Injectable()
  class Allowed implements CanActivate {
    async canActivate(ctx: GuardContext): Promise<boolean> {
      return (await ctx.state.get(privateKey)) === 7;
    }
  }
  @Injectable()
  class Denied implements CanActivate {
    canActivate(): boolean {
      return false;
    }
  }
  @Controller()
  @UseMiddleware(Prepare)
  @UseGuards(Allowed)
  class Handlers {
    @Command('query')
    async query(
      @Arg(0, { type: 'integer', required: true }) number: number,
      @Slot('server', { choices: ['双梦'], normalize: () => '梦江南', required: true })
      server: string,
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @ContextValue(privateKey) value: number,
      @Ctx() ctx: MessageContext,
    ): Promise<void> {
      assert.equal(number, 5);
      assert.equal(server, '梦江南');
      assert.equal(images.length, 1);
      assert.equal(value, 7);
      assert.equal(await ctx.state.get(privateKey), 7);
      await ctx.reply('ok');
    }
    @Command('deny')
    @UseGuards(Denied)
    deny(): void {
      assert.fail('Guard denied');
    }
    @Command('fail')
    fail(): void {
      throw new Error('PRIVATE-FAILURE-TEXT');
    }
  }
  @Module({ controllers: [Handlers], providers: [Prepare, Allowed, Denied] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    bots: [{ appId: 'a' }, { appId: 'b' }],
    diagnostics: { enabled: true, traceSampleRate: 1 },
  });
  await h.app.start();
  try {
    for (const appId of ['a', 'b']) {
      assert.equal(
        await h.dispatch(appId, {
          op: 0,
          t: 'GROUP_MESSAGE_CREATE',
          d: {
            id: 'PRIVATE-MESSAGE-ID',
            group_openid: 'PRIVATE-GROUP-ID',
            author: { member_openid: 'PRIVATE-USER-ID' },
            content: '/query 5 双梦',
            attachments: [{ url: 'https://private.example/secret.png', content_type: 'image/png' }],
          },
        }),
        'accepted',
      );
    }
    await h.dispatch('a', {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'denied',
        content: '/deny',
        author: { user_openid: 'PRIVATE-USER-ID' },
      },
    });
    await h.dispatch('a', {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: 'failed',
        content: '/fail',
        author: { user_openid: 'PRIVATE-USER-ID' },
      },
    });
    assert.equal(h.messages.length, 2);
    assert.equal(h.errors.length, 1);
    assert.equal(loads, 4);
    const snapshot = h.app.diagnostics.snapshot();
    assert.equal(snapshot.activeSpans, 0);
    assert.equal(snapshot.droppedMeasurements, 0);
    const metrics = snapshot.metrics;
    for (const appId of ['a', 'b']) {
      const mine = metrics.filter((m) => m.appId === appId && m.handler?.endsWith('.query'));
      for (const stage of [
        'handler.middleware',
        'handler.guard',
        'handler.bind',
        'handler.context',
        'handler.invoke',
        'context.load',
        'reply.wait',
        'outbound.queue',
        'outbound.run',
        'qq.http',
      ]) {
        assert.ok(
          mine.some((m) => m.stage === stage && m.count > 0),
          `${appId} ${stage}`,
        );
      }
      assert.equal(mine.find((m) => m.stage === 'context.load')!.count, 1);
      assert.equal(mine.find((m) => m.stage === 'context.lookup')!.outcomes['cache-hit'], 2);
    }
    assert.ok(
      metrics.some(
        (m) =>
          m.handler?.endsWith('.deny') && m.stage === 'handler.guard' && m.outcomes.rejected === 1,
      ),
    );
    assert.equal(
      metrics.some((m) => m.handler?.endsWith('.deny') && m.stage === 'handler.bind'),
      false,
    );
    assert.ok(
      metrics.some(
        (m) =>
          m.handler?.endsWith('.fail') && m.stage === 'handler.invoke' && m.outcomes.error === 1,
      ),
    );
    const spans = h.app.diagnostics.takeSpans();
    for (const appId of ['a', 'b']) {
      const mine = spans.filter((s) => s.appId === appId && s.handler?.endsWith('.query'));
      assert.equal(new Set(mine.map((s) => s.traceId)).size, 1);
      const http = mine.find((s) => s.stage === 'qq.http')!;
      assert.equal(http.operation, 'message');
      assert.ok(mine.some((s) => s.spanId === http.parentSpanId && s.stage === 'outbound.run'));
    }
    const a = spans.find((s) => s.appId === 'a' && s.handler?.endsWith('.query'))!;
    const b = spans.find((s) => s.appId === 'b' && s.handler?.endsWith('.query'))!;
    assert.notEqual(a.traceId, b.traceId);
    const json = JSON.stringify({ snapshot, spans });
    for (const privateText of [
      'PRIVATE-',
      'private.example',
      '/query',
      '双梦',
      'offline-fixture-secret-only',
    ])
      assert.equal(json.includes(privateText), false, privateText);
  } finally {
    await h.app.close();
  }
  assert.equal(h.app.diagnostics.snapshot().closed, true);
});

await test('reply serialization is visible before the outbound queue and overlapping times are not treated as CPU time', async () => {
  const clock = new FakeClock();
  const gate = deferred<Response>();
  let sends = 0;
  @Controller()
  class Replies {
    @Command('twice') async twice(@Ctx() ctx: MessageContext): Promise<void> {
      const first = ctx.reply('one');
      const second = ctx.reply('two');
      await Promise.all([first, second]);
    }
  }
  @Module({ controllers: [Replies] })
  class Root {}
  const app = await SingleTestApplication.create(
    Root,
    {
      appId: 'a',
      secret: 'fixture',
      logger: quiet,
      diagnostics: { enabled: true, traceSampleRate: 1 },
      outbound: { concurrency: 8 },
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: (url) => {
        if (
          (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
            'getAppAccessToken',
          )
        )
          return Promise.resolve(Response.json({ access_token: 'fixture', expires_in: 7200 }));
        sends++;
        return sends === 1 ? gate.promise : Promise.resolve(Response.json({ id: 'second' }));
      },
    },
  );
  await app.start();
  try {
    const accepted = app.execution.accept(
      {
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id: 'm',
          content: '/twice',
          author: { user_openid: 'user' },
        },
      },
      128,
    );
    assert.ok('done' in accepted);
    await until(() => sends === 1);
    const before = app.diagnostics.snapshot().metrics;
    assert.equal(before.find((m) => m.stage === 'reply.wait')!.active, 1);
    assert.equal(before.find((m) => m.stage === 'outbound.queue')!.active, 0);
    assert.equal(before.find((m) => m.stage === 'outbound.run')!.active, 1);
    await clock.advance(25);
    gate.resolve(Response.json({ id: 'first' }));
    await accepted.done;
    assert.equal(sends, 2);
    const metrics = app.diagnostics.snapshot().metrics;
    assert.equal(metrics.find((m) => m.stage === 'reply.wait')!.totalMs, 25);
    assert.equal(metrics.find((m) => m.stage === 'handler.invoke')!.totalMs, 25);
    assert.equal(
      metrics.find((m) => m.stage === 'qq.http.headers' && m.operation === 'message')!.totalMs,
      25,
    );
    assert.equal(metrics.find((m) => m.stage === 'event.total')!.totalMs, 25);
    assert.equal(app.diagnostics.snapshot().activeSpans, 0);
    assert.equal(clock.pending, 1);
  } finally {
    gate.resolve(Response.json({ id: 'cleanup' }));
    await app.close();
  }
  assert.equal(clock.pending, 0);
});

await test('HTTP response-body cancellation is separate from headers and never retains a URL or error text', async () => {
  const clock = new FakeClock();
  const r = new Diagnostics(diagnosticsSettings({ enabled: true, traceSampleRate: 1 }), clock);
  const cancel = new AbortController();
  let fetched = false;
  const http = new HttpRuntime(
    resolveOptions({ appId: 'a', secret: 'fixture' }),
    () => {
      fetched = true;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode('private-body'));
            },
            cancel() {},
          }),
        ),
      );
    },
    clock,
    r,
  );
  const request = http.request('https://private.example/secret-url', {}, { signal: cancel.signal });
  const rejected = assert.rejects(request);
  await until(() => fetched);
  await clock.flush();
  assert.equal(r.reader.snapshot().metrics.find((m) => m.stage === 'qq.http.body')!.active, 1);
  await clock.advance(20);
  cancel.abort(new Error('private-error'));
  await rejected;
  const snapshot = r.reader.snapshot();
  assert.equal(snapshot.metrics.find((m) => m.stage === 'qq.http.headers')!.outcomes.success, 1);
  assert.equal(snapshot.metrics.find((m) => m.stage === 'qq.http.body')!.outcomes.cancelled, 1);
  assert.equal(snapshot.metrics.find((m) => m.stage === 'qq.http')!.totalMs, 20);
  assert.equal(snapshot.activeSpans, 0);
  assert.equal(
    JSON.stringify({ snapshot, spans: r.reader.takeSpans() }).includes('private'),
    false,
  );
  http.close();
  await r.close(clock.monotonic() + 100);
  assert.equal(clock.pending, 0);
});

await test('diagnostic exporter failure leaves command results and business error reporting unchanged', async () => {
  @Controller()
  class Commands {
    @Command('ok') ok(): string {
      return 'ok';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const h = await createMultiTestApplication(Root, {
    diagnostics: {
      enabled: true,
      traceSampleRate: 1,
      exportIntervalMs: 1,
      onSpans() {
        throw new Error('private exporter failure');
      },
    },
  });
  await h.app.start();
  try {
    for (const id of ['first', 'second'])
      await h.dispatch('offline-app', {
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id,
          content: '/ok',
          author: { user_openid: 'user' },
        },
      });
    await until(() => h.app.diagnostics.snapshot().exportFailures === 1);
    assert.equal(h.messages.length, 2);
    assert.equal(h.errors.length, 0);
    assert.equal(h.app.diagnostics.snapshot().activeSpans, 0);
  } finally {
    await h.app.close();
  }
});

for (const mode of ['received', 'cancelled', 'timeout'] as const) {
  await test(`prompt ${mode} records suspension separately from execution and retains the original handler trace`, async () => {
    const clock = new FakeClock();
    let status: string | undefined;
    @Controller()
    class Conversation {
      @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
        const result = await ctx.prompt('question', { timeoutMs: 50 });
        status = result.status;
        if (result.status === 'received') await result.message.reply('done');
      }
    }
    @Module({ controllers: [Conversation] })
    class Root {}
    const app = await SingleTestApplication.create(
      Root,
      {
        appId: 'a',
        secret: 'fixture',
        logger: quiet,
        diagnostics: { enabled: true, traceSampleRate: 1 },
      },
      {
        clock,
        transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
        fetch: (url) =>
          Promise.resolve(
            Response.json(
              (typeof url === 'string' ? url : url instanceof URL ? url.href : url.url).includes(
                'getAppAccessToken',
              )
                ? { access_token: 'fixture', expires_in: 7200 }
                : { id: 'sent' },
            ),
          ),
      },
    );
    await app.start();
    try {
      const first = app.execution.accept(
        {
          op: 0,
          t: 'C2C_MESSAGE_CREATE',
          d: {
            id: 'question',
            content: '/ask',
            author: { user_openid: 'user' },
          },
        },
        128,
      );
      assert.ok('done' in first);
      await until(() =>
        app.diagnostics.snapshot().metrics.some((m) => m.stage === 'prompt.wait' && m.active === 1),
      );
      assert.equal(app.snapshot().queue.active, 0);
      const before = app.diagnostics.takeSpans();
      const questionTrace = before.find(
        (s) => s.stage === 'qq.http' && s.operation === 'message',
      )!.traceId;
      await clock.advance(mode === 'timeout' ? 50 : 25);
      if (mode !== 'timeout') {
        app.execution.accept(
          {
            op: 0,
            t: 'C2C_MESSAGE_CREATE',
            d: {
              id: 'answer',
              content: mode === 'cancelled' ? '取消' : 'answer',
              author: { user_openid: 'user' },
            },
          },
          128,
        );
      }
      await first.done;
      assert.equal(status, mode);
      const snapshot = app.diagnostics.snapshot();
      const wait = snapshot.metrics.find((m) => m.stage === 'prompt.wait')!;
      assert.equal(wait.totalMs, mode === 'timeout' ? 50 : 25);
      assert.equal(wait.outcomes[mode === 'received' ? 'success' : mode], 1);
      assert.equal(snapshot.metrics.find((m) => m.stage === 'event.run')!.totalMs, 0);
      assert.equal(snapshot.activeSpans, 0);
      const after = app.diagnostics.takeSpans();
      assert.ok(after.some((s) => s.stage === 'handler.invoke' && s.traceId === questionTrace));
      if (mode === 'received')
        assert.ok(
          after.some(
            (s) =>
              s.stage === 'qq.http' && s.operation === 'message' && s.traceId === questionTrace,
          ),
        );
    } finally {
      await app.close();
    }
    assert.equal(clock.pending, 0);
  });
}
