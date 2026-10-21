# 多机器人与主动发送

一个应用共享业务模块和数据库；每个账号独立管理连接、Token、去重、冷却和对话。

## 配置账号

在 `AppFactory.create()` 中提供 `database` 和 `bots`：

```ts
bots: [
  { appId: process.env.QQ_APP_ID!, secret: process.env.QQ_APP_SECRET! },
  { appId: process.env.QQ_APP_ID_B!, secret: process.env.QQ_APP_SECRET_B!,
    transport: { type: 'webhook' } },
],
webhook: { host: '127.0.0.1', port: 3000 },
```

- 不声明 transport 时使用 WS；账号可以混用 WS/Webhook。
- Webhook 默认路径为 `/qq/<AppID>`。
- 增删账号或更换凭证后重启应用。

## 选择发送方式

| 场景                  | 用法                                             |
| --------------------- | ------------------------------------------------ |
| 回复收到的命令        | 返回消息或 `await ctx.reply(...)`                |
| 当前流程调用 QQ API   | `ctx.client`，绑定来源机器人                     |
| 外部 WS、定时任务通知 | 注入 `MessageSender`，传入完整目标               |
| 指定账号调用 API      | 注入 `BotManager`，使用 `bots.get(appId).client` |

- 保存 `ctx.target`：它包含 `appId`、`scene` 和该账号下的 OpenID。
- **同一真实群在不同机器人下的 groupId 不能互换。** 用户 ID 也按账号和场景保存。
- 后台任务只保存地址及业务数据，不保存 Context 或 `ctx.client`。
- 主动发送仍需 QQ 权限与配额；发送失败不会自动换账号。

完整代码与离线测试见 [多机器人通知示例](../examples/multi-bot.md)。

## 只提供群 OpenID

`MessageSender.sendMessage({ scene: 'group', groupId }, message)` 会查询已保存的归属：

- 已验证的群消息、群按钮会记录该账号的群地址。
- 无候选报 `ROUTE_NOT_FOUND`，多个候选报 `ROUTE_AMBIGUOUS`。
- 注入 `GroupRoutes`，用 `bind({ appId, scene: 'group', groupId })` 指定归属。
- `unbind(groupId)` 仅移除偏好，保留已学习地址。
- 私聊发送必须指定 appId；归属记录不会获得额外的平台发送权限。

## 单独停止与恢复

```ts
await app.bots.get(appId).stop();
await app.bots.get(appId).start();
```

- 停止一个账号不重建共享服务，其他账号继续工作。
- 部分账号不可用时 `app.status` 为 `degraded`，逐账号检查 `status`。
- 全部账号初始启动失败，或共享服务、数据库初始化失败，会导致应用启动失败。
- `app.close()` 关闭整个应用；关闭后创建新应用才能再次运行。
