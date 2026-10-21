# 准备和共享上下文数据

需要多个 Guard 或处理器读取本次执行的数据时，使用上下文中间件。

## 选择方式

| 需求               | API                                               |
| ------------------ | ------------------------------------------------- |
| 定义有类型的数据   | `createContextKey<T>('名称')`，各处复用同一个 Key |
| 注册已经得到的值   | prepare 内 ctx.state.set(KEY, value)              |
| 首次读取时才查询   | prepare 内 ctx.state.provide(KEY, loader)         |
| 在代码中读取       | await ctx.state.get(KEY)                          |
| 作为处理器参数读取 | @ContextValue(KEY)                                |

完整的可复制模块与测试见 [context-module.ts](../assets/context-module.ts)、[测试](../assets/context-module.test.ts)。

## 挂载与执行

- 中间件作为普通 Provider 注册，通过 UseMiddleware 挂在模块、控制器或方法上；模块也可配置 middlewares。
- prepare 返回 `void` 或 `Promise<void>`；异步服务先 await，再 set。
- 支持 Command、OnButton、OnAttachment，不作用于原始 On。
- 顺序为中间件 → Guard → 文字/归一化/附件/身份 → ContextValue → 冷却 → 处理器。
- 各级中间件累加，模块仅覆盖自己的 controllers；权限判断仍由 Guard 完成。

## 数据规则

- Key 按对象身份区分，同名不合并；不要每次读取都新建 Key。
- 同一个 Key 只能注册一次；缺失数据可显式注册类型允许的 undefined，未注册会报错。
- set 不接受 Promise；异步懒加载使用 provide，读取结果用 await。
- 加载最多执行一次，成功、undefined 和失败都缓存，不自动重试。
- 每次处理器执行独立存储；prompt 延续原流程并复用 state。
- prepare 结束后不能写入；Guard 和处理器只获得 get。
- 业务值不会自动深冻结；需要不可变数据时自己构造只读值。

## 取消与错误

- 加载器使用它收到的 signal，不捕获 prepare 的临时信号。
- signal.throwIfAborted 在已取消时抛错；实际异步服务也需要接收信号。
- 默认准备/加载各 10 秒，每次执行最多 64 个 Key，可通过 AppOptions.context 调整。
- 准备和参数读取失败不占冷却；进入处理器后读取失败不退还冷却。
- 处理器结束后的新读取或写入报 INVALID_STATE。
- 中间件不提供 next、消息回复、数据库实现或 DefaultFrom；业务字段选择和缺省策略自行编写。
