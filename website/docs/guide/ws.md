# WebSocket 接入

- 默认接入方式，程序主动连接 QQ。
- 适合本地开发和常驻服务，无需公网回调地址。

## 基础配置

在启动入口中选择 WS，完整入口见 [快速开始](./quick-start.md)：

```ts
const app = await BotFactory.create(AppModule, {
  appId,
  secret,
  transport: { type: 'ws' },
});
```

同一机器人切换设备或版本前，先关闭旧 WS 实例。

## 连接与恢复

- 自动获取 token 和网关，处理心跳、断线重连和会话恢复。
- 首次连接默认最多尝试 6 次；运行后的临时断线继续尝试恢复。
- `app.status` 或 `app.snapshot()` 可查看 running、reconnecting 等状态。
- `app.close()` 后停止重连。

## 可选调整

以下均为默认值，通常无需修改：

```ts
transport: {
  type: 'ws',
  connectTimeoutMs: 15000,
  closeTimeoutMs: 1000,
  heartbeatSequenceField: 's',
  retry: { initialAttempts: 6, baseDelayMs: 1000, maxDelayMs: 30000 }
}
```

- intents 默认 `(1 << 25) | (1 << 26)`，修改前确认账号具备对应权限。
- heartbeatSequenceField 的 `d` 值仅用于明确需要的协议兼容场景。

## 恢复边界

- QQ 不保证补发断线期间的所有事件。
- 进程内去重不跨重启保留；修改数据等操作应使用业务幂等键。
