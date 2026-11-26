# 共享本次请求的数据

同一次执行中，Guard 与处理器需要共享用户资料、权限或配置时，使用上下文中间件。只在一个方法中用一次的查询，直接调用 Service 即可。

## 选择读写方式

| 需要做什么              | 用法                                                |
| ----------------------- | --------------------------------------------------- |
| 定义有类型的数据        | `createContextKey<T>('名称')`，导出并复用同一个 Key |
| 保存已经得到的值        | 在 prepare 中 `ctx.state.set(KEY, value)`           |
| 被读取时才查询          | 在 prepare 中 `ctx.state.provide(KEY, loader)`      |
| 在 Guard 或处理器中读取 | `await ctx.state.get(KEY)`                          |
| 直接注入处理器参数      | `@ContextValue(KEY)`                                |

可复制 [中间件模块](../assets/context-module.ts) 和 [测试](../assets/context-module.test.ts)，替换其中的数据准备逻辑。

## 注册中间件

- 将中间件注册为 Provider，用 `@UseMiddleware(MiddlewareClass)` 挂到模块、控制器或方法；模块也可配置 `middlewares`。
- `prepare(ctx)` 支持 `void` 或 `Promise<void>`。必需的数据可先 await 查询再 set；按需查询用 provide。
- 支持命令、按钮、附件处理器；不作用于原始 `@On`。
- 多层中间件累加：模块配置 → 模块类 → 控制器类 → 方法。模块只覆盖自己的 controllers。
- 中间件在 Guard 前运行；准备失败不会进入业务处理器。权限判断仍写在 Guard 中。
- 中间件只准备数据，不返回消息，也不调用 `next()`。

## 读取与缺省值

- Key 按对象身份区分，同名 Key 不合并；不要在每次读取时重新创建。
- 同一个 Key 只能注册一次。允许空值时使用 `ContextKey<T | undefined>` 并明确注册 undefined。
- 未注册的 Key 会报错，不会当成 undefined。`@ContextValue` 注入完整值，字段选择和参数缺省策略写在处理器中。
- set 不接受 Promise；provide 的同步或异步加载器在第一次 get 时执行。
- 并发读取共享一次加载，成功、undefined 和失败均缓存，不自动重试。
- state 按本次处理器执行隔离，prompt 延续时复用；业务值不会自动深冻结。

## 写权限与取消

- `ctx.state.set/provide` 只在 prepare 中可用；Guard、参数和处理器获得只读的 get 接口。
- prepare 结束后不能继续写入；处理器结束后不能继续使用 state。
- 加载器使用它收到的 signal，不捕获 prepare 的临时信号。
- `signal.throwIfAborted()` 在已取消时抛错；要中止 HTTP 等进行中的请求，还需把 signal 传给该服务。
- 默认准备、加载超时各 10 秒，最多注册 64 个 Key；在 `AppOptions.context` 中调整。
- ContextValue 在文字、附件和身份参数处理后读取，读取失败不占冷却；处理器内才读取失败时不退还冷却。
