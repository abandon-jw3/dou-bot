# 完整配置

入口为 BotFactory.create(AppModule, options)。appId 和 secret 必填，其余配置按下面的默认值处理；未知字段或不合法组合会报 CONFIG。

## 顶层选项

| 字段                     | 类型 / 默认        | 用途                                      |
| ------------------------ | ------------------ | ----------------------------------------- |
| appId、secret            | 非空字符串，必填   | QQ 应用身份与凭证                         |
| transport                | 默认 WS            | 选择 WS 或 Webhook                        |
| commands.prefix          | `/`                | 统一前缀，可为空，不能包含空白            |
| commands.invalidInput    | report             | report 只上报；reply 同时发送解析错误提示 |
| interactions.acknowledge | auto               | auto 自动确认；manual 在业务中确认        |
| logger                   | 内置日志实现       | 自定义 debug/info/warn/error              |
| onError                  | 可选同步或异步回调 | 接收 Error 和 ErrorContext                |

## HTTP / QQ API

| api 字段         | 默认值                                    | 说明                                             |
| ---------------- | ----------------------------------------- | ------------------------------------------------ |
| sandbox          | false                                     | 选择沙箱 API 默认地址                            |
| baseUrl          | https://api.sgroup.qq.com                 | API origin；沙箱默认为 sandbox.api.sgroup.qq.com |
| tokenEndpoint    | https://bots.qq.com/app/getAppAccessToken | token 端点                                       |
| requestTimeoutMs | 10000                                     | 单次调用的总等待预算                             |
| maxUploadBytes   | 10485760                                  | 二进制上传字节上限                               |
| maxResponseBytes | 1048576                                   | API 响应字节上限                                 |

通常无需覆盖端点。地址不能含内嵌凭证；baseUrl 是 origin，不是任意路径前缀。

## WS

| 字段                              | 默认值                   |
| --------------------------------- | ------------------------ |
| type                              | ws                       |
| gatewayUrl                        | 未设置，由网关接口发现   |
| intents                           | `(1 << 25) \| (1 << 26)` |
| heartbeatSequenceField            | s                        |
| connectTimeoutMs / closeTimeoutMs | 15000 / 1000             |
| retry.initialAttempts             | 6                        |
| retry.baseDelayMs / maxDelayMs    | 1000 / 30000             |

## Webhook

| 字段                        | 默认值                        |
| --------------------------- | ----------------------------- |
| type                        | 必须显式指定 webhook          |
| listen / host / port / path | true / 127.0.0.1 / 3000 / /qq |
| maxBodyBytes                | 1048576                       |
| readTimeoutMs               | 10000                         |
| maxConcurrentRequests       | 64                            |
| maxSignatureAgeMs           | 300000                        |

WS 配置不能混入 port/listen 等 Webhook 字段，Webhook 也不能混入 intents 或 retry。

## 执行与容量

| execution 字段                         | 默认值          | 说明                       |
| -------------------------------------- | --------------- | -------------------------- |
| concurrency                            | 8               | 活跃业务并发               |
| queueCapacity                          | 1000            | 待处理事件容量             |
| maxEventBytes                          | 1048576         | 单事件编码字节上限         |
| queueMaxBytes                          | 16777216        | 在途事件编码字节预算       |
| dedupMaxEntries / dedupTtlMs           | 10000 / 600000  | 去重表容量与完成后保留期   |
| replyScopeMaxEntries / replyScopeTtlMs | 10000 / 3600000 | 回复序号作用域容量与保留期 |
| maxContextOperations                   | 32              | 一个流程内受管操作数       |
| errorHandlerTimeoutMs                  | 1000            | 自定义错误回调期限         |
| shutdownTimeoutMs                      | 10000           | 整次关闭的总期限           |
| cooldownMaxEntries                     | 10000           | 冷却记录容量               |

去重和回复作用域容量必须能容纳 concurrency + queueCapacity，字节预算必须不小于单事件上限。容量限制是资源保护，不是精确的 JavaScript 堆内存上限。

## 对话等待

| prompts 字段 | 默认值                          |
| ------------ | ------------------------------- |
| timeoutMs    | 60000；若最大期限更小则取较小值 |
| maxTimeoutMs | 300000                          |
| maxPending   | 1000                            |
| cancelWords  | `['取消']`                      |

每次 ctx.prompt 可以覆盖 timeoutMs 和 cancelWords，但不能超过全局最大期限。多个资源预算共同决定实际可接受的等待数。

## 错误回调示例

以下为 options 中的回调片段：

```ts
onError(error, context) {
  console.error('机器人操作失败', { phase: context.phase, name: error.name });
}
```

回调不应记录完整原始事件或凭证，也不应执行长时间阻塞任务。超时会使当前应用禁用该自定义回调并回到兜底日志；详见 [错误 API](../api/errors.md)。
