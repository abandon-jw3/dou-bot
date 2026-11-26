# 完整配置

- 入口：`AppFactory.create(AppModule, options)`，类型为 AppOptions。
- 必须提供 database 和非空 bots；未知字段、非法整数或组合报 CONFIG。
- 应用预算由所有账号共用；凭证和协议按账号配置。

## 应用配置

| 字段                  | 默认 / 用途                                                   |
| --------------------- | ------------------------------------------------------------- |
| database              | 必填，见 [PostgreSQL](./database.md#连接选项)                 |
| bots                  | 必填；每项包含 appId、secret、可选 transport/api/interactions |
| webhook               | 统一 HTTP 监听：listen=true、host=127.0.0.1、port=3000        |
| commands.prefix       | `/`，可为空，不能包含空白                                     |
| commands.invalidInput | report；reply 同时回复参数错误提示                            |
| execution / outbound  | 入站与出站预算，见下表                                        |
| diagnostics           | 默认关闭，见 [性能观测](./diagnostics.md)                     |
| context / prompts     | 上下文数据与对话等待，见下表                                  |
| logger / onError      | 日志实现与同步/异步错误回调                                   |

## 账号配置

| bots 中的字段            | 默认 / 用途                      |
| ------------------------ | -------------------------------- |
| appId / secret           | 必填，AppID 不重复               |
| transport                | 默认 WS；Webhook 需显式声明 type |
| api                      | QQ HTTP 客户端配置               |
| interactions.acknowledge | auto；manual 在按钮处理器中确认  |

## HTTP / QQ API

以下放在每个账号的 api 中。

| api 字段         | 默认值                                    | 说明                                             |
| ---------------- | ----------------------------------------- | ------------------------------------------------ |
| sandbox          | false                                     | 选择沙箱 API 默认地址                            |
| baseUrl          | https://api.sgroup.qq.com                 | API origin；沙箱默认为 sandbox.api.sgroup.qq.com |
| tokenEndpoint    | https://bots.qq.com/app/getAppAccessToken | token 端点                                       |
| requestTimeoutMs | 10000                                     | 单次调用的总等待预算                             |
| maxUploadBytes   | 10485760                                  | 二进制上传字节上限                               |
| maxResponseBytes | 1048576                                   | API 响应字节上限                                 |

- 通常保留默认端点。
- baseUrl 只填 origin，不能带路径前缀或内嵌凭证。

## WS

以下放在账号 transport 中。

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

监听字段放在应用 webhook 中，下面字段放在账号 transport 中：

| 字段                            | 默认值                       |
| ------------------------------- | ---------------------------- |
| type                            | 显式指定 webhook             |
| path                            | `/qq/<AppID>`                |
| maxBodyBytes                    | 1048576                      |
| readTimeoutMs / verifyTimeoutMs | 10000 / 10000                |
| maxConcurrentRequests           | 64，含读取正文和未结束的验签 |
| maxSignatureAgeMs               | 300000                       |

不要把 host、port、listen 放入账号 transport，也不要混入 WS 的 intents/retry。

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

- 去重、回复记录容量至少为 `concurrency + queueCapacity`。
- queueMaxBytes 至少为 maxEventBytes。
- 这些限制不代表整个进程的内存上限。

## 出站队列

| outbound 字段 | 默认值   |
| ------------- | -------- |
| concurrency   | 8        |
| queueCapacity | 1000     |
| queueMaxBytes | 16777216 |

- 所有账号共用预算；发送图片的上传和发送占同一个名额。
- Token 和协议确认走独立控制通道；增大出站并发不能绕过 QQ 频控。

## 对话等待

| prompts 字段 | 默认值                          |
| ------------ | ------------------------------- |
| timeoutMs    | 60000；若最大期限更小则取较小值 |
| maxTimeoutMs | 300000                          |
| maxPending   | 1000                            |
| cancelWords  | `['取消']`                      |

- 单次 prompt 可覆盖 timeoutMs、cancelWords，不能超过全局最长期限。
- 实际等待容量同时受事件、字节和缓存预算限制。

## 上下文数据

| context 字段     | 默认值 | 作用                            |
| ---------------- | ------ | ------------------------------- |
| prepareTimeoutMs | 10000  | 每个中间件准备的最长时间        |
| loadTimeoutMs    | 10000  | 每个加载器首次读取后的最长时间  |
| maxEntries       | 64     | 每次处理器执行注册的 Key 数上限 |

- 均为 1～2147483647 的整数，超时报 CONTEXT_TIMEOUT。
- 首次懒加载计入 maxContextOperations，缓存读取不重复计数。
- 注册和读取方式见 [上下文中间件](./context.md)。

## 错误回调示例

以下为 options 中的回调片段：

```ts
onError(error, context) {
  console.error('机器人操作失败', { phase: context.phase, name: error.name });
}
```

- 只记录必要字段，不记录完整原始事件或凭证。
- 回调超时后应用改用兜底日志，详见 [错误 API](../api/errors.md)。
