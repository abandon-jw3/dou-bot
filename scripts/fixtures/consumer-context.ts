import assert from 'node:assert/strict';
import {
  Arg,
  Command,
  Controller,
  ContextValue,
  Ctx,
  createContextKey,
  Injectable,
  Module,
  UseMiddleware,
} from 'dou-bot';
import type { ContextMiddleware, MessageContext, MiddlewareContext } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

const MARKER = createContextKey<Readonly<{ user: string }>>('consumer-marker');
let prepared = 0;
let loaded = 0;
@Injectable()
class Marker implements ContextMiddleware {
  async prepare(ctx: MiddlewareContext): Promise<void> {
    prepared++;
    await Promise.resolve();
    ctx.state.provide(MARKER, async (signal) => {
      signal.throwIfAborted();
      loaded++;
      await Promise.resolve();
      return Object.freeze({ user: ctx.userId });
    });
  }
}
@Controller()
@UseMiddleware(Marker)
class Commands {
  @Command('context') async context(
    @ContextValue(MARKER) value: Readonly<{ user: string }>,
    @Arg(0) input: string,
    @Ctx() ctx: MessageContext,
  ): Promise<string> {
    assert.equal(value, await ctx.state.get(MARKER));
    assert.equal(value.user, ctx.userId);
    return `${value.user}:${input}`;
  }
}
@Module({ controllers: [Commands], providers: [Marker] })
class Root {}
const h = await createTestApplication(Root);
await h.app.start();
try {
  for (const group of [false, true]) {
    await h.dispatch({
      op: 0,
      t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      d: {
        id: `context-${group}`,
        content: '/context --legacy extra',
        ...(group
          ? { group_openid: 'group', author: { member_openid: 'user' } }
          : { author: { user_openid: 'user' } }),
      },
    });
  }
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['user:--legacy', 'user:--legacy'],
  );
  assert.equal(prepared, 2);
  assert.equal(loaded, 2);
  assert.deepEqual(h.errors, []);
} finally {
  await h.app.close();
}
console.log(
  'Context middleware, lazy state and parameter injection verified in the current tarball.',
);
