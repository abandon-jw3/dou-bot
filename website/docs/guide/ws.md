# WebSocket 接入

- 默认接入方式：应用主动连接 QQ，无需公网回调入口。
- 每个账号独立连接、心跳和恢复；同一机器人切换实例前先停止旧实例。

## 配置账号

在 [快速开始](./quick-start.md) 的 bots 中填写：

```ts
bots: [{ appId, secret, transport: { type: 'ws' } }];
```

通常保留默认值；需要调整时放在该账号的 transport 中：

```ts
transport: {
  type: 'ws',
  connectTimeoutMs: 15000,
  closeTimeoutMs: 1000,
  heartbeatSequenceField: 's',
  retry: { initialAttempts: 6, baseDelayMs: 1000, maxDelayMs: 30000 },
}
```

## 连接状态

- 自动获取 Token 和网关，处理心跳、断线重连与会话恢复。
- 首次连接默认最多尝试 6 次；运行后的临时断线持续尝试恢复。
- `app.bots.get(appId).status` 查看 running/reconnecting 等账号状态。
- 一个账号异常时应用可能为 degraded；其他账号仍可服务。
- intents 默认 `(1 << 25) | (1 << 26)`，需匹配账号的实际权限。

## 恢复边界

- 断线期间不保证补齐所有事件；自动恢复不等于业务数据恢复。
- 去重与冷却不跨重启保存；重要修改使用业务幂等键。
- 使用自己的账号验证私聊、群聊、附件和按钮收发。
