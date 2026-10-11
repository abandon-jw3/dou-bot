# 生命周期

## 创建、启动、关闭

| 操作                        | 作用                                             |
| --------------------------- | ------------------------------------------------ |
| `await BotFactory.create()` | 检查配置，创建依赖，执行初始化钩子               |
| `await app.start()`         | 启动 QQ 接入                                     |
| `await app.close()`         | 停止接收，取消对话，等待或取消在途任务，清理资源 |

关闭后的实例不能重新启动，需要创建新应用。

## 模块资源钩子

在注册的 Service 上实现钩子，支持同步或异步：

<<< @/../examples/lifecycle/resource.service.ts

- 模块类本身不会自动实例化，钩子放在 Provider 中。
- `useValue` 传入的外部资源由调用者关闭。

## 协作取消

- 外部 fetch 等异步请求传入上下文的 `signal`。
- 框架不能强制终止不配合取消的 JavaScript。
- 处理器结束后不复用旧 Context；延迟任务只保存必要的业务数据。

## 退出处理

- 捕获 SIGINT/SIGTERM 并等待 `app.close()`，写法见 [快速开始](./quick-start.md)。
- Windows 终端使用 `Ctrl+C` 正常退出。
- 强制结束进程或断电无法保证清理钩子完成。
