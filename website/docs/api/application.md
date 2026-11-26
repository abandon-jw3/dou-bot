# 应用与配置 API

从 `dou-bot` 导入；配置默认值见 [配置指南](../guide/configuration.md)。

## AppFactory.create

```ts
AppFactory.create(root: Type, options: AppOptions): Promise<Application>
```

- 必须提供 database 和非空 bots；业务模块由所有账号共享。
- create 检查配置、模块图和路由声明；start 打开数据库、初始化共享服务，再连接账号。
- 不自动建表；首次运行先调用 migrateDatabase。

完整入口：

<<< @/../examples/hello/main.ts

## Application

| 成员                 | 用途                                                                  |
| -------------------- | --------------------------------------------------------------------- |
| status               | created / starting / running / degraded / stopping / stopped / failed |
| bots                 | BotManager，按 appId 读取账号                                         |
| start() / close()    | 启动与整体关闭，返回 `Promise<void>`                                  |
| get(token, options?) | start 成功后读取服务；options.module 指定模块                         |
| webhookHandler()     | 挂载到自有 Node HTTP 服务                                             |
| snapshot()           | 应用入站、出站、数据库和各账号快照                                    |
| diagnostics          | 阶段指标与采样读取器                                                  |

- 关闭后不能重启同一个应用；单账号停止/恢复使用 BotHandle。
- Application 不提供默认 client；发送时明确账号或使用当前 ctx.client。

## BotManager / BotHandle

- `bots.list()` 返回只读账号列表，`bots.get(appId)` 读取一个账号。
- handle 提供 appId、status、client、snapshot()、start() 和 stop()。
- client 绑定该账号，可以缓存；停止期间调用失败，恢复后可继续使用。
- `ctx.client` 仅限当前执行，处理器结束后不可复用。

## Module 与 Provider

- ModuleMetadata 支持 imports、providers、controllers、exports、guards、middlewares。
- 支持类、useValue、useClass、异步 useFactory；详见 [模块](../guide/modules.md)。
- 内置令牌：BotManager、MessageSender、GroupRoutes、Database、LOGGER。
- QQClient、QQApi 不作为共享注入令牌；通过选定账号获取。
- 生命周期时机见 [生命周期](../guide/lifecycle.md)，完整声明见 [类型索引](./types.md)。
