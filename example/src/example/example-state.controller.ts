import {
  Command,
  Controller,
  ContextValue,
  createContextKey,
  Ctx,
  Injectable,
  UseMiddleware,
} from 'dou-bot';
import type { ContextMiddleware, MessageContext, MiddlewareContext } from 'dou-bot';

interface RouteInfo {
  readonly route: string;
  readonly scene: 'group' | 'private';
}
const ROUTE_INFO = createContextKey<RouteInfo>('example.route');
const SCENE_LABEL = createContextKey<string>('example.scene-label');

@Injectable()
export class ExampleStateMiddleware implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    const info = Object.freeze({ route: ctx.route, scene: ctx.scene });
    // 已有的值直接 set；只属于本次处理，不保存在单例字段中。
    ctx.state.set(ROUTE_INFO, info);
    // 首次 get 才执行；实际异步服务应接收加载器提供的 signal。
    ctx.state.provide(SCENE_LABEL, (signal) => {
      signal.throwIfAborted();
      return Promise.resolve(info.scene === 'group' ? '群聊' : '私聊');
    });
  }
}

@Controller()
@UseMiddleware(ExampleStateMiddleware)
export class ExampleStateController {
  @Command('example-state', { description: '准备上下文数据，并通过参数和 state 读取' })
  async state(
    @ContextValue(ROUTE_INFO) info: RouteInfo,
    @Ctx() ctx: MessageContext,
  ): Promise<string> {
    const scene = await ctx.state.get(SCENE_LABEL);
    return `命令：${info.route}；会话：${scene}`;
  }
}
