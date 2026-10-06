# 应用与配置 API

导入入口：dou-bot。完整的配置默认值见 [配置指南](../guide/configuration.md)，类型声明索引见 [公共声明](./types.md)。

## BotFactory.create

```ts
BotFactory.create(root: Type, options: BotOptions): Promise<BotApplication>
```

创建并初始化模块、依赖注入与路由。root 为根模块类；options 至少包含 appId、secret，transport 默认 WS。返回已创建但尚未建立 QQ 接入的应用，之后调用 start。

配置、依赖或路由校验失败会拒绝 Promise。创建失败时，根据错误码检查配置字段、Provider 注册和命令名；具体步骤见 [排错指南](../guide/troubleshooting.md)。

完整示例：

<<< @/../examples/hello/main.ts

## BotApplication

| 成员                 | 参数 / 返回          | 用途与限制                                    |
| -------------------- | -------------------- | --------------------------------------------- |
| status               | ApplicationStatus    | 只读运行状态                                  |
| client               | QQClient             | 高层客户端，可在明确目标下发送                |
| start()              | Promise&lt;void&gt;  | 启动接入；失败通过拒绝和错误渠道报告          |
| close()              | Promise&lt;void&gt;  | 按统一期限清理；关闭后不能重启同一实例        |
| get(token, options?) | 对应的 T             | 读取可见依赖，options.module 可指定模块       |
| webhookHandler()     | Node RequestListener | 仅 Webhook 接入有效；宿主负责 server 生命周期 |
| snapshot()           | ApplicationSnapshot  | 当前状态、队列、prompt 和事件计数快照         |

ApplicationStatus 为 created、starting、running、reconnecting、stopping、stopped 或 failed。快照中的 accepted 是接纳计数，不是业务成功计数。

## ModuleMetadata 与 Provider

ModuleMetadata 的 imports、providers、controllers、exports、guards 都是可选数组。模块只提供自己声明的可见性，不按文件目录自动扫描。guards 按数组顺序作用于本模块控制器。

Provider 支持类简写，以及 ClassProvider、ValueProvider、FactoryProvider。InjectionToken 可以是类、抽象类、字符串或 Symbol；工厂依赖用 inject 数组指定，工厂可以返回 Promise。

参考 [模块与依赖注入](../guide/modules.md)。QQClient、QQApi、LOGGER 是保留的内置令牌。

## 生命周期接口

OnModuleInit 提供 onModuleInit(signal)，OnModuleDestroy 提供 onModuleDestroy(signal)，均返回 void 或 Promise&lt;void&gt;。钩子在注册的服务上实现，模块类本身不自动实例化。

<<< @/../examples/lifecycle/resource.service.ts

初始化失败会触发已创建资源的回收；外部传入 useValue 的资源由调用者负责。关闭期限不能强制终止任意不配合取消的 JavaScript。
