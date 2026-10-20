# 多机器人应用

> 本页介绍新版本，当前尚未发布。

## 创建应用

- 一个应用共享 Module、Controller、Provider 和 PostgreSQL 连接池。
- 每个机器人独立保存凭证、Token、连接、去重、prompt 和回复状态。
- 启动时确定机器人列表；增删账号或更新凭证需要重启应用。

```ts
import { AppFactory } from 'dou-bot';
import { AppModule } from './app.module.js';

const app = await AppFactory.create(AppModule, {
  database: {
    host: '127.0.0.1',
    user: 'bot',
    database: 'bot',
    password: process.env.DATABASE_PASSWORD!,
  },
  bots: [
    { appId: process.env.QQ_APP_ID_A!, secret: process.env.QQ_SECRET_A! },
    {
      appId: process.env.QQ_APP_ID_B!,
      secret: process.env.QQ_SECRET_B!,
      transport: { type: 'webhook' },
    },
  ],
  webhook: { host: '127.0.0.1', port: 3000 },
});
await app.start();
```

- `create()` 校验配置和模块图；`start()` 才连接数据库、构造服务并接入 QQ。
- 首次部署先显式执行 [数据库迁移](database.md)。启动不会自动建表。
- Webhook 默认路径为 `/qq/<AppID>`。共用一个 HTTP 监听入口，逐账号校验请求头与签名。
- 自己管理 HTTP 服务时设置 `webhook.listen: false`，使用 `app.webhookHandler()`。

### Webhook 请求限制

- 在账号的 `transport` 中配置；以下为默认值。
- `maxConcurrentRequests: 64`：读取正文和验签共享请求名额；满时返回 503。
- `readTimeoutMs: 10000`：读取正文的最长等待时间，超时返回 408。
- `verifyTimeoutMs: 10000`：异步验签的最长等待时间，超时返回 503，不执行消息。
- `maxBodyBytes: 1048576`：单个正文最多 1 MiB，超限返回 413。
- 验签失败或时间戳过期返回 403。超时或断线后，仍在运行的底层验签继续占用名额，直到完成；关闭应用受统一关闭期限约束。

## 回复与主动发送

- 命令中返回消息或使用 `ctx.reply()`，自动由来源机器人回复。
- `ctx.client` 绑定来源机器人和当前执行；执行结束后不能复用。
- 外部 WS、定时任务使用注入的 `MessageSender` 或 `BotManager`。
- 在事件中跨账号发送时传入 `{ signal: ctx.signal }` 并等待完成；错误记录可同时提供来源 `sourceAppId` 和发送方 `appId`。

```ts
import { Injectable, MessageSender } from 'dou-bot';
import type { BotTarget } from 'dou-bot';

@Injectable()
export class Notifications {
  constructor(private readonly sender: MessageSender) {}

  async notify(target: BotTarget): Promise<void> {
    await this.sender.sendMessage(target, '有新的消息');
  }
}
```

业务可保存完整的 `ctx.target`。它包含 `appId`、场景和该机器人收到的 OpenID。

**同一真实群，在不同机器人下的 groupId 可能不同。** 地址必须按 `(appId, groupId)` 保存；框架不合并真实群，也不跨机器人替换 OpenID。

## 群归属选择

- `sendMessage({ appId, scene: 'group', groupId }, message)`：明确选择机器人。
- `sendMessage({ scene: 'group', groupId }, message)`：查询持久化归属。
- 群消息和群按钮经过验证后，框架记录该账号的群地址。普通群消息不会触发未匹配的业务处理器。
- 无记录：`ROUTE_NOT_FOUND`；多个账号候选：`ROUTE_AMBIGUOUS`。
- 使用 `GroupRoutes.bind({ appId, scene: 'group', groupId })` 设置明确归属；`unbind(groupId)` 只移除偏好，保留已学习地址。
- 选中的机器人离线、停用或不在当前配置中时，发送失败；不自动换账号。
- 私聊主动发送必须提供 `appId`。群归属不证明该机器人拥有发送权限。

## 生命周期

| 时机                     | 钩子                            |
| ------------------------ | ------------------------------- |
| 数据库就绪、账号尚未启动 | `onModuleInit(signal)`          |
| 可用账号已启动           | `onApplicationReady(signal)`    |
| 停止接纳新任务           | `onApplicationStopping(signal)` |
| 在途工作排空后           | `onModuleDestroy(signal)`       |

- 外部 WS、定时器放在 `onApplicationReady` 启动，在停止钩子中关闭。
- 部分账号失败时应用为 `degraded`，其他账号继续运行。
- 全部账号初始启动失败，或数据库/共享服务初始化失败，应用启动失败并清理资源。
- `app.bots.get(appId).stop()` 只停止该账号；`start()` 显式恢复它，不重建共享服务。
- 可以缓存该账号的 `client`；停止期间请求失败，恢复后继续使用。`ctx.client` 仍仅限当前执行。
- `app.close()` 关闭整个应用；关闭后不能重启同一个应用对象。

## 容量与交付

- 入站 `execution` 与出站 `outbound` 各自有界；默认并发 8、等待 1000、保留数据 16 MiB。
- 已接纳工作按账号轮流执行。prompt 等待时释放入站执行名额。
- 队列满会拒绝；业务应限制扇出规模，处理失败并尊重取消信号。
- 图片上传和发送使用同一个出站名额；Token、协议确认不排在用户消息后面。
- `snapshot()` 提供应用、各账号、队列与连接池状态。
- 消息任务、冷却和执行去重仍在内存中。进程重启后不恢复未完成消息，也不保证跨进程只执行一次。

## 离线测试

```ts
import { createMultiTestApplication } from 'dou-bot/testing';
const h = await createMultiTestApplication(AppModule, {
  bots: [{ appId: 'a' }, { appId: 'b' }],
});
await h.app.start();
await h.dispatch('a', {
  op: 0,
  t: 'C2C_MESSAGE_CREATE',
  d: { id: 'm', content: '/hello', author: { user_openid: 'u' } },
});
await h.app.close();
```

- 测试入口使用内存持久化夹具和模拟 QQ 网络；不能据此认定真实 PostgreSQL/QQ 验收通过。
- `createTestApplication` 提供单账号测试视图，`h.app.snapshot()` 返回该账号的 `BotSnapshot`。
