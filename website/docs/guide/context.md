# 上下文中间件

在处理器执行前准备数据，让 Guard 和处理器共用本次执行的结果。**0.8.0 起提供。**

## 选择读取方式

| 操作           | 用法                                              |
| -------------- | ------------------------------------------------- |
| 定义数据类型   | `createContextKey<T>('名称')`，各处复用同一个 Key |
| 注册已有值     | 在 prepare 内 `ctx.state.set(KEY, value)`         |
| 需要时才加载   | 在 prepare 内 `ctx.state.provide(KEY, loader)`    |
| 在代码中读取   | `await ctx.state.get(KEY)`                        |
| 注入处理器参数 | `@ContextValue(KEY)`                              |

## 最小示例

<<< @/../examples/context/app.module.ts

发送 `/上下文`，收到当前命令和会话类型。运行步骤见 [上下文示例](../examples/context.md)。

## 同步与异步准备

- prepare 可返回 `void` 或 `Promise<void>`，框架等待它完成后再执行 Guard。
- 数据已取得时用 set；异步服务先 await，再 set。
- 只在需要时查询的数据用 provide；首次读取才调用 loader。
- 加载器使用收到的 signal，传给实际异步服务；不要捕获 prepare 的临时信号。
- `signal.throwIfAborted()` 在已取消时抛错，防止继续工作。

## 注册与作用范围

- 中间件作为普通 Provider 注册，可注入业务 Service。
- UseMiddleware 可放在模块类、控制器类或处理方法上；模块也可配置 middlewares。
- 顺序：模块配置 → 模块类 → 控制器类 → 方法；规则不自动去重。
- 模块只覆盖自己的 controllers，不传播到 imports。
- 支持 Command、OnButton、OnAttachment；原始 On 不执行中间件。
- 中间件只准备数据；权限判断用 Guard，消息回复放在处理器中。

## 数据与生命周期

- Key 按对象身份区分，同名 Key 不合并；名称须为非空单行字符串。
- 同一个 Key 只能注册一次；未注册与已注册 undefined 严格区分。
- set 不接受 Promise/thenable；get 始终返回 Promise。
- 并发和后续读取共享加载结果，成功、undefined、失败都缓存，不自动重试。
- 每个处理器执行独立存储；prompt 复用原流程的 state。
- prepare 结束后不能写入；Guard、消息和按钮 Context 只提供 get。
- 接口冻结，业务值不自动深冻结；处理器结束后的新读写报 INVALID_STATE。

## 执行与错误

**中间件 → Guard → 文字/归一化/附件/身份参数 → ContextValue → 冷却 → 处理器**。

- ContextValue 不消费输入，也不进入帮助列表。
- prepare 只能完成准备，不能用 false、消息或 next 控制后续流程。
- 准备或参数注入失败不占冷却；处理器内加载失败不退还冷却。
- 错误阶段为 middleware / context，超时为 CONTEXT_TIMEOUT；不会自动回复输入错误提示。
- 默认准备/加载超时各 10 秒，每次执行最多 64 个 Key；见 [配置](./configuration.md#上下文数据)。
