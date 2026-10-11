// Source-only framework demonstration; no database, credentials or real QQ connection.
import {
  Command,
  Controller,
  ContextValue,
  Ctx,
  createContextKey,
  Injectable,
  Module,
  UseMiddleware,
} from '../src/index.js';
import type { ContextMiddleware, MessageContext, MiddlewareContext } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

const ROUTE_LABEL = createContextKey<string>('route.label');
const EXECUTION_INFO =
  createContextKey<Readonly<{ route: string; scene: 'group' | 'private' }>>('execution.info');
@Injectable()
class RouteLabel implements ContextMiddleware {
  async prepare(ctx: MiddlewareContext): Promise<void> {
    ctx.state.set(EXECUTION_INFO, Object.freeze({ route: ctx.route, scene: ctx.scene }));
    await Promise.resolve();
    ctx.state.provide(ROUTE_LABEL, (signal) => {
      signal.throwIfAborted();
      console.log('按需生成本次执行的数据');
      return `${ctx.kind}:${ctx.route}:${ctx.scene}`;
    });
  }
}
@Controller()
@UseMiddleware(RouteLabel)
class Commands {
  @Command('context') async context(
    @ContextValue(ROUTE_LABEL) label: string,
    @ContextValue(EXECUTION_INFO) info: Readonly<{ route: string; scene: 'group' | 'private' }>,
    @Ctx() ctx: MessageContext,
  ): Promise<string> {
    const sameInfo = info === (await ctx.state.get(EXECUTION_INFO));
    return `set 注册的数据：${info.route}:${info.scene}；两种读取方式共享对象：${sameInfo}\nprovide 加载的数据：${label}；再次读取：${await ctx.state.get(ROUTE_LABEL)}`;
  }
  @Command('unused') unused(): string {
    return '此命令未读取扩展数据，加载器不会执行。';
  }
}
@Module({ controllers: [Commands], providers: [RouteLabel] })
class Root {}
const h = await createTestApplication(Root);
await h.app.start();
try {
  for (const [index, content] of ['/context', '/unused'].entries()) {
    await h.dispatch({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: `context-example-${index}`, author: { user_openid: 'offline-user' }, content },
    });
    console.log(`${content}\n${h.messages.at(-1)?.payload.content}`);
  }
} finally {
  await h.app.close();
}
