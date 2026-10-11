# 上下文中间件与数据注入

**0.8.0 起提供；0.7.0 不包含本页 API。**

- `prepare()`：在处理器执行前准备数据，支持同步或异步。
- `ctx.state.set()`：注册已经取得的数据。
- `ctx.state.provide()`：注册需要时才执行的加载器。
- `ctx.state.get()` / `@ContextValue()`：在 Guard 或处理器中读取数据。

## 定义与注册

```ts
import {
  Command,
  Controller,
  ContextValue,
  createContextKey,
  Injectable,
  Module,
  UseMiddleware,
} from 'dou-bot';
import type { ContextMiddleware, MiddlewareContext } from 'dou-bot';

const ROUTE_LABEL = createContextKey<string>('route.label');

@Injectable()
class RouteLabel implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    ctx.state.set(ROUTE_LABEL, `${ctx.route}:${ctx.scene}`);
  }
}

@Controller()
@UseMiddleware(RouteLabel)
class Commands {
  @Command('context')
  context(@ContextValue(ROUTE_LABEL) label: string): string {
    return label;
  }
}

@Module({ controllers: [Commands], providers: [RouteLabel] })
class AppModule {}
```

- 中间件作为普通 Provider 注册，可构造注入业务 Service。
- `@UseMiddleware(A, B)` 可放在模块类、控制器类或处理方法上。
- 模块也可配置 `@Module({ middlewares: [A, B] })`，仅覆盖自己直接注册的控制器。
- 适用于 Command、OnButton、OnAttachment；原始 On 不执行中间件。
- 创建应用时检查声明，匹配到处理器后才执行 prepare。
- Provider 默认单例，不把当前执行的数据放入实例字段。

## 数据注册与消费

| API                            | 用法                                             |
| ------------------------------ | ------------------------------------------------ |
| createContextKey<T>(name)      | 定义有类型的 Key，保存并导出同一个对象供各处使用 |
| ctx.state.set(KEY, value)      | prepare 内同步注册值，不接受 Promise/thenable    |
| ctx.state.provide(KEY, loader) | prepare 内注册加载器，注册时不执行               |
| await ctx.state.get(KEY)       | 读取完整值，返回类型由 Key 决定                  |
| @ContextValue(KEY)             | 将完整值注入处理器参数                           |

- Key 名称须为非空单行字符串，仅用于诊断；同名 Key 仍是不同令牌。
- 同一个 Key 只能注册一次，不能覆盖；允许值为 0、false、空字符串或类型允许的 undefined。
- 未注册 Key 与已注册 undefined 不同，前者报 HANDLER_CONTRACT。
- Guard、MessageContext、ButtonContext 只有 get；只有 MiddlewareContext 提供 set/provide。
- 接口被冻结，业务值不会自动复制或深冻结。

### set：提前准备

同步值直接注册：

```ts
prepare(ctx: MiddlewareContext): void {
  ctx.state.set(ROUTE_LABEL, ctx.route);
}
```

异步数据先 await，再 set。以下 loadLabel 是业务函数，需自行提供：

```ts
async prepare(ctx: MiddlewareContext): Promise<void> {
  const label = await loadLabel(ctx.route, ctx.signal);
  ctx.state.set(ROUTE_LABEL, label);
}
```

- 整个 prepare 完成后，才进入下一步。
- set 同步返回 void；get 统一返回 Promise，读取仍需 await。
- 不要把 Promise 传给 set，也不要提前返回后在异步回调里写入。

### provide：按需加载

```ts
prepare(ctx: MiddlewareContext): void {
  const route = ctx.route;
  ctx.state.provide(ROUTE_LABEL, async (signal) => {
    signal.throwIfAborted();
    return loadLabel(route, signal);
  });
}
```

- 首次 get 或 ContextValue 才加载，未读取则不执行。
- 并发和后续读取共享同一 Promise；成功、undefined、失败都缓存，不自动重试。
- 使用加载器收到的 signal；不要捕获只在 prepare 期间有效的 ctx.signal。
- `signal.throwIfAborted()` 在已取消时立即抛错；异步调用也应接收 signal。
- 不自动分析加载依赖，循环等待最终由超时终止。

### 读取数据

```ts
const label = await ctx.state.get(ROUTE_LABEL);
```

- Guard 可读取与处理器相同的数据。
- ContextValue 按参数顺序读取，同 Key 只加载一次。
- 不消费文字或附件，不出现在帮助中。
- 不能用于构造参数或原始 On。

## 执行顺序与生命周期

**中间件 → Guard → 文字/归一化/附件/身份参数 → ContextValue → 冷却 → 处理器**。

- 中间件顺序：模块配置 → 模块类 → 控制器类 → 方法。
- 列表从左到右，装饰器从上到下；类继承时基类在先，不自动去重。
- 每个 prepare 结束立即撤销它的写权限。
- 数据按一次处理器执行隔离，不同用户、调用、附件处理器不共享存储。
- prompt 延续同一执行、复用 state，不重新运行中间件。
- 处理器返回后禁止新读取，已开始的加载受框架跟踪；迟到读写报 INVALID_STATE。
- 首次加载计入 maxContextOperations；缓存读取和 set 注册的值不重复计数。
- 应用关闭或超时会取消等待，外部异步工作需配合 signal。

## 超时、资源与错误

在 BotFactory.create 的 options 中配置，以下为默认值：

```ts
context: {
  prepareTimeoutMs: 10000,
  loadTimeoutMs: 10000,
  maxEntries: 64,
}
```

| 配置             | 作用                             |
| ---------------- | -------------------------------- |
| prepareTimeoutMs | 每个 prepare 的最长时间          |
| loadTimeoutMs    | 每个加载器从首次读取起的最长时间 |
| maxEntries       | 每次执行最多注册的 Key 数        |

- 均为 1～2147483647 的整数；超时为 CONTEXT_TIMEOUT，超出 Key 容量为 RESOURCE_LIMIT。
- prepare 只能返回 void/Promise<void>；不能用 false、消息或 next 控制流程。
- 准备错误阶段为 middleware，读取错误为 context；同一次加载失败只上报一次。
- 业务 catch 不撤销已经产生的 onError 记录，错误不作为输入提示自动回复。
- 准备或参数注入失败不占冷却；进入处理器后读取失败不退还冷却。
- 一个附件处理器失败后继续其他匹配处理器，按钮确认规则不变。

## 示例与升级

- [完整源码示例](https://github.com/abandon-jw3/dou-bot/blob/main/framework/examples/context.ts)：在 framework 目录运行 `npm run example:context`，无需 QQ 或数据库。
- 自行构造 Context 测试对象时补充 state reader。
- 错误类型的穷尽判断补充 middleware、context、CONTEXT_TIMEOUT。
- 此功能只负责准备与读取数据；数据库查询、字段选择和缺省策略由业务定义。
