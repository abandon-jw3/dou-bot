# 账号、发送与 QQ API

- 回复当前消息：返回内容或 ctx.reply；访问当前 QQ API 用 ctx.client。
- 后台通知：注入 MessageSender，传入带 appId 的 BotTarget。
- 指定账号：注入 BotManager，使用 bots.get(appId).client。
- QQClient / QQApi 不是共享 Provider；不直接构造注入它们。

## MessageSender / GroupRoutes

- `sender.sendMessage(target, message, options?)` 返回 `Promise<SendResult>`。
- 私聊目标必须包含 appId；群目标可按持久化归属解析。
- GroupRoutes 提供 list(groupId)、resolve(groupId)、bind(target)、unbind(groupId)。
- 无归属/归属歧义分别报 ROUTE_NOT_FOUND / ROUTE_AMBIGUOUS；账号不可用报 BOT_UNAVAILABLE。
- 同一真实群的不同账号 OpenID 不能混用，见 [多机器人](../guide/multi-bot.md)。

## QQClient

| 方法                                       | 参数                                     | 返回                         |
| ------------------------------------------ | ---------------------------------------- | ---------------------------- |
| getSelf(options?)                          | RequestOptions                           | Promise&lt;BotUser&gt;       |
| sendMessage(target, message, options?)     | MessageTarget、MessageInput、SendOptions | Promise&lt;SendResult&gt;    |
| uploadImage(target, source, options?)      | 目标、URL 或 Uint8Array、RequestOptions  | Promise&lt;UploadedImage&gt; |
| deleteMessage(target, messageId, options?) | 目标、消息 ID、RequestOptions            | Promise&lt;void&gt;          |
| api                                        | 只读 QQApi                               | 底层客户端                   |

- 使用前明确账号、目标和平台权限，主动发送仍受平台限制。
- 以下 `/bot-info` 通过 BotManager 获取来源机器人的客户端，向请求传入 ctx.signal。

<<< @/../examples/client/app.module.ts

## QQApi 具名方法

| 方法                                                   | 参数                              | 返回                           |
| ------------------------------------------------------ | --------------------------------- | ------------------------------ |
| getSelf(options?)                                      | RequestOptions                    | Promise&lt;BotUser&gt;         |
| getGateway(options?)                                   | RequestOptions                    | Promise&lt;{ url: string }&gt; |
| sendGroupMessage(groupId, payload, options?)           | 群 OpenID、QQMessagePayload       | Promise&lt;SendResult&gt;      |
| sendPrivateMessage(userId, payload, options?)          | 用户 OpenID、QQMessagePayload     | Promise&lt;SendResult&gt;      |
| uploadGroupImage(groupId, payload, options?)           | 群 OpenID、QQUploadImagePayload   | Promise&lt;QQFileResult&gt;    |
| uploadPrivateImage(userId, payload, options?)          | 用户 OpenID、QQUploadImagePayload | Promise&lt;QQFileResult&gt;    |
| deleteGroupMessage(groupId, messageId, options?)       | 群 OpenID、消息 ID                | Promise&lt;void&gt;            |
| deletePrivateMessage(userId, messageId, options?)      | 用户 OpenID、消息 ID              | Promise&lt;void&gt;            |
| acknowledgeInteraction(interactionId, code?, options?) | 交互 ID、默认 code=0              | Promise&lt;void&gt;            |

- 未另行说明的 options 均为 RequestOptions。
- 原始 QQ payload 与高层 MessageInput 不同；优先使用消息助手和 QQClient，确有协议需求时再使用具名底层端点。

## 通用 request

```ts
request<T = unknown>(method: HttpMethod, path: string, options?: ApiRequestOptions): Promise<ApiResponse<T>>
```

- HttpMethod 为 GET、POST、PUT、PATCH 或 DELETE。
- path 是同源 API 路径；options 支持 query、body、signal、timeoutMs。
- ApiResponse 包含 data、status 和可选 traceId。
- request 是底层 HTTP 能力，不替应用补齐任意接口的业务约束。
- 特别是手动构造按钮、消息引用或上传参数时，调用方需确保原始协议正确。
- 泛型 T 仅影响静态类型，不能代替对外部响应的校验。

## 错误与生命周期

- QQ 业务错误及 HTTP 失败以 QQApiError 提供可用的状态码、平台码和 traceId。
- 传入 signal 并 await 请求；业务自己的重试策略应避免重复副作用。
- 默认 API 调用超时为 10000ms，可被合法的每次调用 timeoutMs 覆盖。
- 字段细节可在 [公共类型声明](./types.md) 中查阅 RequestOptions、ApiRequestOptions、QQMessagePayload、QQUploadImagePayload 和 QQFileResult。
