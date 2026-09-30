import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  Command,
  Controller,
  Ctx,
  FrameworkError,
  GroupManagersOnly,
  Module,
  On,
  OnButton,
} from '../src/index.js';
import type {
  BotOptions,
  ButtonContext,
  ErrorContext,
  MessageContext,
  PromptOptions,
  PromptResult,
  QQDispatch,
  QQMessagePayload,
  Type,
} from '../src/index.js';
import { Application } from '../src/core/application.js';
import type { Admission } from '../src/core/execution.js';
import { resolveOptions } from '../src/core/config.js';
import { deferred } from './helpers.js';
import { FakeClock } from './fake-clock.js';

let next = 0;
function message(
  content: string,
  user = 'u',
  group?: string,
  extra: Record<string, unknown> = {},
): QQDispatch {
  return {
    op: 0,
    t: group === undefined ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `prompt-${++next}`,
      content,
      ...(group === undefined
        ? { author: { user_openid: user } }
        : { group_openid: group, author: { member_openid: user } }),
      ...extra,
    },
  };
}
function done(admission: Admission): Promise<void> {
  assert.ok('done' in admission);
  return admission.done;
}
interface SendRequest {
  path: string;
  payload: QQMessagePayload;
  signal?: AbortSignal | null;
}
async function fixture(
  t: TestContext,
  controller: Type,
  options: Partial<BotOptions> = {},
  send?: (request: SendRequest) => Promise<Response | undefined> | Response | undefined,
  allowCloseFailure = false,
) {
  const clock = new FakeClock();
  const messages: SendRequest[] = [];
  const errors: { error: Error; context: ErrorContext }[] = [];
  @Module({ controllers: [controller] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      appId: 'prompt-app',
      secret: 'prompt-fixture-secret',
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError: (error, context) => {
        errors.push({ error, context });
      },
      ...options,
    },
    {
      clock,
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: async (input, init) => {
        const path = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        ).pathname;
        if (path === '/app/getAppAccessToken')
          return Response.json({ access_token: 'offline-token', expires_in: 7200 });
        if (path.startsWith('/interactions/')) return new Response(null, { status: 204 });
        if (!path.endsWith('/messages')) throw new Error('Unexpected prompt fixture endpoint');
        assert.equal(typeof init?.body, 'string');
        const payload = JSON.parse(init!.body as string) as QQMessagePayload;
        const request = {
          path,
          payload,
          ...(init?.signal === undefined ? {} : { signal: init.signal }),
        };
        const response = await send?.(request);
        if (response) return response;
        messages.push(request);
        return Response.json({ id: `reply-${messages.length}` });
      },
    },
  );
  t.after(async () => {
    const closing = app.close();
    const observed = closing.then(
      () => undefined,
      (error: unknown) => error,
    );
    await clock.advance(options.execution?.shutdownTimeoutMs ?? 10000);
    const error = await observed;
    if (error !== undefined && !allowCloseFailure) {
      assert.ok(error instanceof Error);
      throw error;
    }
  });
  await app.start();
  const enqueue = (event: QQDispatch, bytes = Buffer.byteLength(JSON.stringify(event))) =>
    app.execution.accept(event, bytes);
  return { app, clock, messages, errors, enqueue };
}

for (const scene of ['private', 'group'] as const) {
  await test(`multi-round ${scene} prompts retain input data and use each input's own reply scope`, async (t) => {
    let saved: MessageContext | undefined;
    let result: PromptResult | undefined;
    @Controller()
    class Commands {
      @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
        const first = await ctx.prompt('name?');
        if (first.status !== 'received') return;
        saved = first.message;
        await first.message.reply(`name:${first.message.content}`);
        result = await first.message.prompt('image?');
        if (result.status === 'received') {
          assert.equal(result.message.signal, ctx.signal);
          assert.equal(result.message.attachments[0]?.filename, 'image.png');
          await result.message.reply('complete');
        }
      }
    }
    const f = await fixture(t, Commands, { execution: { concurrency: 1 } });
    const group = scene === 'group' ? 'g' : undefined;
    const root = f.enqueue(message('/ask', 'u', group, { id: 'root' }));
    await f.clock.flush();
    assert.equal(f.app.snapshot().queue.active, 0);
    const first = f.enqueue(message('Ada', 'u', group, { id: 'first' }));
    await f.clock.flush();
    assert.equal(f.app.snapshot().prompts.pending, 1);
    const last = f.enqueue(
      message('', 'u', group, {
        id: 'last',
        attachments: [
          {
            url: 'https://example.com/image.png',
            filename: 'image.png',
            content_type: 'image/png',
          },
        ],
      }),
    );
    await Promise.all([done(root), done(first), done(last)]);
    assert.deepEqual(
      f.messages.map((m) => [m.payload.msg_id, m.payload.msg_seq]),
      [
        ['root', 1],
        ['first', 1],
        ['first', 2],
        ['last', 1],
      ],
    );
    assert.equal(result?.status, 'received');
    assert.equal(saved?.signal.aborted, true);
    assert.ok(saved);
    await assert.rejects(saved.reply('late'), /finished/u);
    await assert.rejects(saved.prompt('late'), /finished/u);
    assert.deepEqual(f.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
    assert.equal(f.app.snapshot().prompts.pending, 0);
  });
}

await test('waiters isolate applications, users, private/group scenes and separate groups', async (t) => {
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const answer = await ctx.prompt('Q');
      if (answer.status === 'received') await answer.message.reply(answer.message.content);
    }
  }
  const a = await fixture(t, Commands, { execution: { concurrency: 1 } });
  const b = await fixture(t, Commands, { appId: 'other-app', execution: { concurrency: 1 } });
  const starts = [
    a.enqueue(message('/ask')),
    a.enqueue(message('/ask', 'v')),
    a.enqueue(message('/ask', 'u', 'g1')),
    a.enqueue(message('/ask', 'u', 'g2')),
    b.enqueue(message('/ask')),
  ];
  await a.clock.flush();
  await b.clock.flush();
  assert.equal(a.app.snapshot().prompts.pending, 4);
  assert.equal(b.app.snapshot().prompts.pending, 1);
  assert.equal(a.enqueue(message('outsider', 'x', 'g1')).status, 'ignored');
  const answers = [
    a.enqueue(message('private-u')),
    a.enqueue(message('private-v', 'v')),
    a.enqueue(message('group-1', 'u', 'g1')),
    a.enqueue(message('group-2', 'u', 'g2')),
  ];
  await Promise.all([...starts.slice(0, 4), ...answers].map(done));
  assert.equal(b.app.snapshot().prompts.pending, 1);
  const other = b.enqueue(message('other-app'));
  await Promise.all([done(starts[4]!), done(other)]);
  assert.deepEqual(
    a.messages
      .slice(4)
      .map((m) => m.payload.content)
      .sort(),
    ['group-1', 'group-2', 'private-u', 'private-v'],
  );
  assert.equal(b.messages[1]?.payload.content, 'other-app');
});

await test('more waiters than concurrency do not block normal commands; continuations reacquire bounded slots', async (t) => {
  const gate = deferred<void>();
  let running = 0,
    maximum = 0;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const answer = await ctx.prompt('Q');
      if (answer.status !== 'received') return;
      running++;
      maximum = Math.max(maximum, running);
      await gate.promise;
      await answer.message.reply('A');
      running--;
    }
    @Command('ping') ping() {
      return 'pong';
    }
  }
  const f = await fixture(t, Commands, { execution: { concurrency: 2 } });
  const roots = Array.from({ length: 12 }, (_, i) => f.enqueue(message('/ask', `u${i}`)));
  await f.clock.flush();
  assert.equal(f.app.snapshot().prompts.pending, 12);
  assert.equal(f.app.snapshot().queue.active, 0);
  await done(f.enqueue(message('/ping', 'independent')));
  const answers = Array.from({ length: 12 }, (_, i) => f.enqueue(message('answer', `u${i}`)));
  await f.clock.flush();
  assert.equal(running, 2);
  assert.equal(f.app.snapshot().queue.active, 2);
  gate.resolve();
  await Promise.all([...roots, ...answers].map(done));
  assert.equal(maximum, 2);
  assert.equal(f.messages.length, 25);
  assert.equal(f.errors.length, 0);
});

await test('matching input is admitted when ordinary work fills the queue, and resumes through the same FIFO', async (t) => {
  const gate = deferred<void>();
  const order: string[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const result = await ctx.prompt('Q');
      if (result.status === 'received') {
        order.push('answer');
        await result.message.reply('A');
      }
    }
    @Command('block') async block(): Promise<void> {
      await gate.promise;
    }
    @Command('ping') ping() {
      order.push('ping');
      return 'pong';
    }
  }
  const f = await fixture(t, Commands, { execution: { concurrency: 1, queueCapacity: 1 } });
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const block = f.enqueue(message('/block', 'blocker'));
  await f.clock.flush();
  const ping = f.enqueue(message('/ping', 'other'));
  assert.equal(f.enqueue(message('/ping', 'overflow')).status, 'overloaded');
  const answer = f.enqueue(message('answer'));
  assert.equal(answer.status, 'accepted');
  assert.equal(f.app.snapshot().prompts.pending, 1);
  gate.resolve();
  await Promise.all([root, block, ping, answer].map(done));
  assert.deepEqual(order, ['ping', 'answer']);
});

await test('timeout is monotonic, starts after sending, and late messages take normal routes', async (t) => {
  let result: PromptResult | undefined;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      result = await ctx.prompt('Q');
    }
    @Command('late') late() {
      return 'late command';
    }
  }
  const sent = deferred<Response | undefined>();
  const f = await fixture(t, Commands, { prompts: { timeoutMs: 20 } }, (r) =>
    r.payload.content === 'Q' ? sent.promise : undefined,
  );
  const root = f.enqueue(message('/ask'));
  await f.clock.advance(100);
  assert.equal(result, undefined);
  assert.equal(f.app.snapshot().queue.active, 1);
  sent.resolve(undefined);
  await f.clock.flush();
  f.clock.jumpWall(1e10);
  await f.clock.advance(19);
  assert.equal(result, undefined);
  await f.clock.advance(1);
  await done(root);
  assert.deepEqual(result, { status: 'timeout' });
  assert.equal(f.app.snapshot().prompts.pending, 0);
  await done(f.enqueue(message('/late')));
  assert.equal(f.messages[1]?.payload.content, 'late command');
  assert.equal(f.errors.length, 0);
});

await test('default cancellation, custom exact words, disabled words and option snapshots are explicit', async (t) => {
  let options: PromptOptions = {};
  const results: PromptResult[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      results.push(await ctx.prompt('Q', options));
    }
  }
  const f = await fixture(t, Commands);
  for (const [configured, text, expected] of [
    [{}, ' 取消 ', 'cancelled'],
    [{ cancelWords: ['STOP'] }, 'stop', 'received'],
    [{ cancelWords: [] }, '取消', 'received'],
    [{ cancelWords: [' STOP '] }, 'STOP', 'cancelled'],
  ] as const) {
    options = configured;
    const root = f.enqueue(message('/ask'));
    await f.clock.flush();
    const answer = f.enqueue(message(text));
    await Promise.all([done(root), done(answer)]);
    assert.equal(results.at(-1)?.status, expected);
  }
  const words = ['STOP'];
  options = { cancelWords: words, timeoutMs: 20 };
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  words[0] = 'changed';
  options.timeoutMs = 1;
  await f.clock.advance(2);
  const answer = f.enqueue(message('STOP'));
  await Promise.all([done(root), done(answer)]);
  assert.equal(results.at(-1)?.status, 'cancelled');
});

await test('fast input is held until the question succeeds and does not execute commands or observers', async (t) => {
  let result: PromptResult | undefined,
    observed = 0,
    pings = 0;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      result = await ctx.prompt('Q');
      if (result.status === 'received') await result.message.reply(result.message.content);
    }
    @Command('ping') ping() {
      pings++;
      return 'pong';
    }
    @On('C2C_MESSAGE_CREATE') observe(): void {
      observed++;
    }
  }
  const sent = deferred<Response | undefined>();
  const f = await fixture(t, Commands, { execution: { concurrency: 1 } }, (r) =>
    r.payload.content === 'Q' ? sent.promise : undefined,
  );
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const answer = f.enqueue(message('/ping', 'u', undefined, { id: 'answer' }));
  await f.clock.flush();
  assert.equal(result, undefined);
  sent.resolve(undefined);
  await Promise.all([done(root), done(answer)]);
  assert.equal((result as PromptResult | undefined)?.status, 'received');
  assert.equal(pings, 0);
  assert.equal(observed, 1);
  assert.equal(f.messages[1]?.payload.msg_id, 'answer');
});

await test('failed question unregisters the waiter and returns captured input to ordinary dispatch exactly once', async (t) => {
  let caught = false,
    pings = 0;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      try {
        await ctx.prompt('Q');
      } catch {
        caught = true;
      }
    }
    @Command('ping') ping() {
      pings++;
      return 'pong';
    }
  }
  const sent = deferred<Response | undefined>();
  const f = await fixture(t, Commands, { execution: { concurrency: 1 } }, (r) =>
    r.payload.content === 'Q' ? sent.promise : undefined,
  );
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const payload = message('/ping', 'u', undefined, { id: 'fallback' });
  const input = f.enqueue(payload);
  sent.resolve(Response.json({ code: 500, message: 'send failed' }, { status: 500 }));
  await Promise.all([done(root), done(input)]);
  assert.equal(caught, true);
  assert.equal(pings, 1);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  assert.equal(f.messages[0]?.payload.msg_id, 'fallback');
  assert.equal(f.enqueue(payload).status, 'duplicate');
  assert.equal(f.errors.length, 1);
});

await test('duplicate captured input cannot answer the next round even after ordinary dedup TTL passes', async (t) => {
  const answers: string[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const a = await ctx.prompt('Q1');
      if (a.status !== 'received') return;
      answers.push(a.message.content);
      const b = await a.message.prompt('Q2');
      if (b.status === 'received') answers.push(b.message.content);
    }
  }
  const f = await fixture(t, Commands, {
    execution: { dedupTtlMs: 5 },
    prompts: { timeoutMs: 100 },
  });
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const payload = message('one');
  const first = f.enqueue(payload);
  await f.clock.flush();
  await f.clock.advance(10);
  const duplicate = f.enqueue(payload);
  assert.equal(duplicate.status, 'duplicate');
  assert.equal(f.app.snapshot().prompts.pending, 1);
  const last = f.enqueue(message('two'));
  await Promise.all([root, first, last, duplicate].map(done));
  assert.deepEqual(answers, ['one', 'two']);
  assert.equal(f.app.snapshot().queue.retainedBytes, 0);
});

await test('one waiter per conversation and a bounded global count reject before sending extra questions', async (t) => {
  const codes: string[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      try {
        await ctx.prompt('Q');
      } catch (error) {
        if (error instanceof FrameworkError) codes.push(error.code);
      }
    }
  }
  const f = await fixture(t, Commands, { prompts: { maxPending: 1 } });
  // Both commands arrive before either starts its waiter; the second must not replace the first.
  const a = f.enqueue(message('/ask'));
  const b = f.enqueue(message('/ask'));
  await f.clock.flush();
  const c = f.enqueue(message('/ask', 'other'));
  await done(c);
  await done(b);
  assert.deepEqual(codes, ['INVALID_STATE', 'RESOURCE_LIMIT']);
  assert.equal(f.messages.length, 1);
  const answer = f.enqueue(message('取消'));
  await Promise.all([done(a), done(answer)]);
  const d = f.enqueue(message('/ask', 'other'));
  await f.clock.flush();
  const last = f.enqueue(message('取消', 'other'));
  await Promise.all([done(d), done(last)]);
  assert.equal(f.messages.length, 2);
});

await test('captured input still obeys byte limits without consuming the waiter on overload', async (t) => {
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      await ctx.prompt('Q');
    }
  }
  const f = await fixture(t, Commands, { execution: { maxEventBytes: 1024, queueMaxBytes: 1024 } });
  const root = f.enqueue(message('/ask', 'u', undefined, { padding: 'x'.repeat(400) }));
  await f.clock.flush();
  const tooLarge = f.enqueue(message('x'.repeat(600)));
  assert.equal(tooLarge.status, 'overloaded');
  assert.equal(f.app.snapshot().prompts.pending, 1);
  const answer = f.enqueue(message('ok'));
  await Promise.all([done(root), done(answer)]);
  assert.equal(f.app.snapshot().queue.retainedBytes, 0);
});

await test('prompt options validate before sending; invalid questions release reservations', async (t) => {
  let options: PromptOptions = {};
  let question = 'Q';
  const codes: string[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      try {
        await ctx.prompt(question, options);
      } catch (error) {
        if (error instanceof FrameworkError) codes.push(error.code);
      }
    }
  }
  const f = await fixture(t, Commands, { prompts: { maxTimeoutMs: 100 } });
  for (const invalid of [
    null,
    { extra: true },
    { timeoutMs: 0 },
    { timeoutMs: 101 },
    { timeoutMs: NaN },
    { cancelWords: [''] },
    { cancelWords: [123] },
    { cancelWords: Array<string>(1) },
  ]) {
    options = invalid as PromptOptions;
    await done(f.enqueue(message('/ask')));
  }
  options = {};
  question = '';
  await done(f.enqueue(message('/ask')));
  assert.equal(codes.length, 9);
  assert.ok(codes.every((code) => code === 'HANDLER_CONTRACT'));
  assert.equal(f.messages.length, 0);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  for (const prompts of [
    null,
    { extra: true },
    { maxPending: 0 },
    { maxTimeoutMs: 10, timeoutMs: 11 },
    { cancelWords: [null] },
  ])
    assert.throws(
      () =>
        resolveOptions({
          appId: 'app',
          secret: 'secret',
          prompts: prompts as NonNullable<BotOptions['prompts']>,
        }),
      (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
    );
});

await test('closing an application aborts and cleans waiting prompts without waiting for their timeout', async (t) => {
  let signal: AbortSignal | undefined,
    continued = false;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      signal = ctx.signal;
      await ctx.prompt('Q');
      continued = true;
    }
  }
  const f = await fixture(t, Commands);
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  await f.app.close();
  await done(root);
  assert.equal(signal?.aborted, true);
  assert.equal(continued, false);
  assert.equal(f.clock.pending, 0);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  assert.deepEqual(f.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
  assert.equal(f.enqueue(message('late')).status, 'stopping');
});

await test('shutdown during question sending releases a fast captured input and ignores late HTTP completion', async (t) => {
  const sent = deferred<Response | undefined>();
  let continued = false;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      await ctx.prompt('Q');
      continued = true;
    }
  }
  const f = await fixture(t, Commands, {}, () => sent.promise);
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const input = f.enqueue(message('answer'));
  await f.app.close();
  await Promise.all([done(root), done(input)]);
  sent.resolve(Response.json({ id: 'late-question' }));
  await f.clock.flush();
  assert.equal(continued, false);
  assert.equal(f.clock.pending, 0);
  assert.equal(f.app.snapshot().queue.retainedBytes, 0);
});

await test('shutdown deadline cancels a ready continuation queued behind an uncooperative handler', async (t) => {
  const blocked = deferred<void>();
  let continued = false;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      await ctx.prompt('Q');
      continued = true;
    }
    @Command('block') async block(): Promise<void> {
      await blocked.promise;
    }
  }
  const f = await fixture(
    t,
    Commands,
    { execution: { concurrency: 1, shutdownTimeoutMs: 10 } },
    undefined,
    true,
  );
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const blocker = f.enqueue(message('/block', 'other'));
  await f.clock.flush();
  const answer = f.enqueue(message('answer'));
  const closing = assert.rejects(
    f.app.close(),
    (error: unknown) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
  );
  await f.clock.advance(10);
  await closing;
  await Promise.all([root, blocker, answer].map(done));
  blocked.resolve();
  await f.clock.flush();
  assert.equal(continued, false);
  assert.equal(f.clock.pending, 0);
  assert.deepEqual(f.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
});

await test('callbacks do not satisfy message prompts, and latest input roles remain available for business rechecks', async (t) => {
  let latest: string | undefined,
    clicks = 0;
  @Controller()
  class Commands {
    @Command('ask')
    @GroupManagersOnly()
    async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const answer = await ctx.prompt('Q');
      if (answer.status === 'received' && answer.message.scene === 'group') {
        latest = answer.message.memberRole;
        await answer.message.reply(
          latest === 'owner' || latest === 'admin' ? 'allowed' : 'permission changed',
        );
      }
    }
    @OnButton('click') clicked(@Ctx() ctx: ButtonContext): void {
      assert.equal('prompt' in ctx, false);
      clicks++;
    }
  }
  const f = await fixture(t, Commands);
  const root = f.enqueue(
    message('/ask', 'u', 'g', { author: { member_openid: 'u', member_role: 'owner' } }),
  );
  await f.clock.flush();
  await done(
    f.enqueue({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'click',
        chat_type: 1,
        group_openid: 'g',
        group_member_openid: 'u',
        data: { resolved: { button_id: 'click' } },
      },
    }),
  );
  assert.equal(clicks, 1);
  assert.equal(f.app.snapshot().prompts.pending, 1);
  const answer = f.enqueue(
    message('confirm', 'u', 'g', { author: { member_openid: 'u', member_role: 'member' } }),
  );
  await Promise.all([done(root), done(answer)]);
  assert.equal(latest, 'member');
  assert.equal(f.messages[1]?.payload.content, 'permission changed');
});

await test('a handler that returns before awaiting its prompt cannot leave a waiter or valid late context', async (t) => {
  let rejected = false;
  @Controller()
  class Commands {
    @Command('ask') ask(@Ctx() ctx: MessageContext): void {
      // Deliberate misuse: observing the error does not make a detached prompt a live workflow.
      ctx.prompt('Q').catch(() => {
        rejected = true;
      });
    }
  }
  const f = await fixture(t, Commands);
  await done(f.enqueue(message('/ask')));
  assert.equal(rejected, true);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  assert.equal(f.enqueue(message('answer')).status, 'ignored');
  assert.equal(f.app.snapshot().queue.retainedBytes, 0);
});

await test('the context operation limit bounds multi-round prompts and releases all captured messages on failure', async (t) => {
  let code: string | undefined;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      try {
        const one = await ctx.prompt('Q1');
        if (one.status !== 'received') return;
        const two = await one.message.prompt('Q2');
        if (two.status !== 'received') return;
        await two.message.prompt('Q3');
      } catch (error) {
        if (error instanceof FrameworkError) code = error.code;
      }
    }
  }
  const f = await fixture(t, Commands, { execution: { maxContextOperations: 4 } });
  const root = f.enqueue(message('/ask'));
  await f.clock.flush();
  const one = f.enqueue(message('one'));
  await f.clock.flush();
  const two = f.enqueue(message('two'));
  await Promise.all([root, one, two].map(done));
  assert.equal(code, 'RESOURCE_LIMIT');
  assert.equal(f.messages.length, 2);
  assert.equal(f.app.snapshot().prompts.pending, 0);
  assert.deepEqual(f.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
});

await test('global prompt configuration is snapshotted, and a delayed timer cannot accept input at its deadline', async (t) => {
  const settings = { timeoutMs: 20, cancelWords: ['STOP'] };
  let result: PromptResult | undefined;
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      result = await ctx.prompt('Q');
    }
  }
  const f = await fixture(t, Commands, { prompts: settings });
  settings.cancelWords[0] = 'changed';
  settings.timeoutMs = 1;
  const first = f.enqueue(message('/ask'));
  await f.clock.flush();
  const cancel = f.enqueue(message('STOP'));
  await Promise.all([first, cancel].map(done));
  assert.deepEqual(result, { status: 'cancelled' });
  const second = f.enqueue(message('/ask'));
  await f.clock.flush();
  // Simulate elapsed monotonic time before the event loop gets to deliver the timeout callback.
  const mock = t.mock.method(f.clock, 'monotonic', () => 20);
  assert.equal(f.enqueue(message('too late')).status, 'ignored');
  await done(second);
  mock.mock.restore();
  assert.deepEqual(result, { status: 'timeout' });
  assert.equal(f.app.snapshot().prompts.pending, 0);
});

await test('the same group message delivered as full and mention events cannot fill two prompt rounds', async (t) => {
  const answers: string[] = [];
  @Controller()
  class Commands {
    @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
      const one = await ctx.prompt('Q1');
      if (one.status !== 'received') return;
      answers.push(one.message.content);
      const two = await one.message.prompt('Q2');
      if (two.status === 'received') answers.push(two.message.content);
    }
  }
  const f = await fixture(t, Commands);
  const root = f.enqueue(message('/ask', 'u', 'g'));
  await f.clock.flush();
  const payload = message('one', 'u', 'g');
  const one = f.enqueue(payload);
  await f.clock.flush();
  const repeated = f.enqueue({ ...payload, t: 'GROUP_AT_MESSAGE_CREATE' });
  assert.equal(repeated.status, 'duplicate');
  assert.equal(f.app.snapshot().prompts.pending, 1);
  const two = f.enqueue(message('two', 'u', 'g'));
  await Promise.all([root, one, repeated, two].map(done));
  assert.deepEqual(answers, ['one', 'two']);
});
