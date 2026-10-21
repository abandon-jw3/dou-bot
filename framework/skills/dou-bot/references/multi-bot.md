# 多机器人与后台通知

## 账号选择

- AppFactory 的 bots 列表配置多个账号，可混用 WS/Webhook。
- 当前处理器 return/ctx.reply 自动使用来源机器人；ctx.client 仅限本次执行。
- 外部 WS、定时任务注入 MessageSender，传入完整 BotTarget。
- 指定账号 API 使用 `bots.get(appId).client`（bots 为注入的 BotManager），不构造注入 QQClient/QQApi。

完整实现见 [通知模块](../assets/notifications-module.ts) 与 [双账号测试](../assets/notifications-module.test.ts)。

## 地址保存

- 从 ctx.target 保存 appId、scene 和群/用户 OpenID。
- 同一真实群在不同账号下的 groupId 不能互换；私聊与群成员 ID 也不能自动合并。
- 业务订阅记录以账号与场景划分；后台任务不保存 Context 或 ctx.client。
- 用户要求发给某群但没有可用地址时，先通过该机器人收到的事件取得地址，不猜测或替换。

## 群归属

- 显式 BotTarget 直接选择账号。
- 只传 `{ scene: 'group', groupId }` 时，由已学习地址和 GroupRoutes 解析。
- 无记录报 ROUTE_NOT_FOUND，多个候选报 ROUTE_AMBIGUOUS。
- GroupRoutes.bind(target) 指定归属；unbind(groupId) 保留已学习地址。
- 账号不可用报 BOT_UNAVAILABLE，不自动切换；私聊必须提供 appId。

## 后台工作

- onApplicationReady 建立外部 WS；onApplicationStopping 断开并停止新增任务。
- 业务自己管理断线重试、取消、去重和消息是否需要持久化。
- 不做无界 Promise.all 扇出；限制并发并处理实际发送失败。
- 单账号 stop/start 不重建共享服务；应用 degraded 时检查各账号状态。
- QQ 主动发送受权限和配额限制，离线通过后按任务范围做真实确认。
