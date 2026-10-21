# 生命周期

## 启动顺序

| 操作 / 钩子                     | 时机                                      |
| ------------------------------- | ----------------------------------------- |
| `AppFactory.create()`           | 检查配置、模块图与路由声明，创建应用对象  |
| `app.start()`                   | 打开数据库、检查结构、构造共享服务        |
| `onModuleInit(signal)`          | 初始化业务资源；账号尚未启动              |
| `onApplicationReady(signal)`    | 可用账号已启动，可连接外部 WS、启动定时器 |
| `onApplicationStopping(signal)` | 停止接纳新工作，关闭业务事件来源          |
| `onModuleDestroy(signal)`       | 在途工作排空后释放资源                    |

- 钩子放在已注册的 Provider/Controller，支持同步或异步；模块类不自动实例化。
- 业务服务在 start 时初始化；start 成功后使用 `app.get(...)`。
- 由 useValue 传入的外部资源由调用者负责关闭。

## 后台任务

<<< @/../examples/lifecycle/resource.service.ts

- 外部 WS 的回调通过 `MessageSender` 发送，保存完整 BotTarget。
- 停止钩子先断开来源，避免排空期间又创建新任务。
- 正在执行的外部请求应配合自己的取消信号；处理器请求传入 `ctx.signal`。

## 关闭应用

- 捕获 SIGINT/SIGTERM，等待 `app.close()`；Windows 终端可按 Ctrl+C。
- 关闭会取消对话，并在统一期限内排空业务与受管请求，最终关闭数据库。
- 不能强制终止不配合取消的 JavaScript；强杀或断电不保证钩子完成。
- 关闭后的应用不能重启；仅停止账号时用 `app.bots.get(appId).stop()`。
