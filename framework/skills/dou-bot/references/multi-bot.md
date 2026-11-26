# 多机器人与后台通知

## 选择谁来发送

| 发送场景               | 用法                                             |
| ---------------------- | ------------------------------------------------ |
| 回复刚收到的命令或文件 | 返回消息或 `ctx.reply()`，自动使用来源机器人     |
| 外部 WS、定时任务通知  | 注入 `MessageSender`，传入保存的完整 `BotTarget` |
| 调用某个账号的 API     | 注入 `BotManager`，使用 `bots.get(appId).client` |

- `AppFactory` 的 bots 列表配置账号，可混用 WS/Webhook；业务服务在所有账号间共享。
- `ctx.client` 只用于本次执行；后台服务不保存旧 Context，也不直接注入 QQClient/QQApi。
- 处理器中调用后台发送服务时，传递 `ctx.signal` 并 await 结果。
- 完整实现见 [通知模块](../assets/notifications-module.ts) 与 [双账号测试](../assets/notifications-module.test.ts)。

## 保存通知地址

- 从收到的事件保存完整 `ctx.target`：appId、scene，以及 groupId 或 userId。
- 同一真实群在不同机器人下的 groupId 不能互换；框架不会自动合并它们。
- 私聊用户和群成员的 OpenID 也不能直接视为同一标识。
- 订阅记录按账号、场景和目标保存；用户要接收通知时，通过目标机器人与会话取得实际地址。
- 没有地址时先完成绑定流程，不用日常 QQ 号或另一个机器人的 OpenID 代替。

## 只保存了 groupId 时

- 完整 BotTarget 直接选定账号；群目标未提供 appId 时，`MessageSender` 查询已学习地址及 `GroupRoutes`。
- 无记录报 `ROUTE_NOT_FOUND`，多个候选报 `ROUTE_AMBIGUOUS`。
- `GroupRoutes.bind(target)` 指定发送归属；`unbind(groupId)` 移除偏好，保留已学习地址。
- 群归属不负责转换不同机器人的 OpenID，也不保证 QQ 允许主动发送。
- 目标账号不可用报 `BOT_UNAVAILABLE`，不会自动切换账号；私聊必须提供 appId。

## 连接外部 WS 或定时器

- 在 `onApplicationReady` 建立连接或启动任务，在 `onApplicationStopping` 停止新增任务并清理。
- 业务管理断线重试、取消、去重，以及通知是否需要持久化。
- 给批量发送设置并发上限，处理每次失败，不对全部订阅无界 Promise.all。
- 单账号 stop/start 不重建共享服务；应用 degraded 时检查各账号状态。
- QQ 主动发送受权限和配额限制，需按实际使用场景确认收发。
