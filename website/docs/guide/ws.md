# WebSocket 接入

WS 是默认接入方式。你的程序主动连接 QQ 并保持在线，适合本地开发或常驻服务，不需要公网 HTTP 回调地址。

## 基础配置

在 [快速开始](./quick-start.md) 的 `src/main.ts` 中，创建应用时选择 WS：

```ts
const app = await BotFactory.create(AppModule, {
  appId,
  secret,
  transport: { type: 'ws' },
});
```

[快速开始](./quick-start.md) 已提供完整入口。QQ_APP_ID 与 QQ_APP_SECRET 来自你的机器人账号，保存在本地环境中。确认同一机器人的其他 WS 程序已经关闭，再启动新实例，避免连接相互影响。

## 连接与恢复

框架负责获取 token 和网关、建立连接、心跳与 ACK、断线退避和会话恢复。默认首次连接最多尝试 6 次，退避基础 1000ms、上限 30000ms；成功运行后的临时断线会继续尝试恢复。

使用 app.status 或 app.snapshot 观察 starting、running、reconnecting 等状态。关闭实例后不会继续重连。

## 可选调整

```ts
transport: {
  type: 'ws',
  connectTimeoutMs: 15000,
  closeTimeoutMs: 1000,
  heartbeatSequenceField: 's',
  retry: { initialAttempts: 6, baseDelayMs: 1000, maxDelayMs: 30000 }
}
```

通常保留默认值。intents 是数字位掩码，0.6.0 默认采用 `(1 << 25) | (1 << 26)`；只有明确具备平台权限并理解事件要求时才覆盖。heartbeatSequenceField 默认 s，d 是显式兼容选项。

## 恢复边界

断线后框架会尝试恢复会话，但 QQ 不一定补发断线期间的所有事件。需要可靠业务记账时，在自己的存储中记录操作状态，并使用幂等键避免重复执行；进程内去重不会跨重启保留。
