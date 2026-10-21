# 发送消息与图片

- 简单回复：从命令返回字符串或消息对象。
- 分步回复：`await ctx.reply()`，随后返回 `void`。

<<< @/../examples/messages/app.module.ts

## 选择发送方式

| 方式                                                | 用途                           |
| --------------------------------------------------- | ------------------------------ |
| 命令返回消息                                        | 自动引用当前命令消息           |
| ctx.reply(message)                                  | 引用当前消息，自动管理回复序号 |
| ctx.send(message)                                   | 无引用发送，受账号权限限制     |
| MessageSender.sendMessage(target, message, options) | 从服务向明确目标发送           |

上下文方法要在处理器内 await；定时任务注入 MessageSender 并传入完整 BotTarget，不保存旧 Context。

## 图片来源

`image(source, { caption? })` 支持：

- HTTP(S) URL。
- Uint8Array 或 Node Buffer；本地文件先用 `readFile()` 读取。
- 同一机器人账号、API 环境和目标下仍有效的 UploadedImage。

注意：

- 字符串表示 URL，不表示文件路径。
- 默认二进制上传上限为 10 MiB；QQ 还可能有独立限制。
- UploadedImage 不能跨账号、群或私聊目标复用，也不能使用已过期的凭据。

## 发送结果

| status        | 含义                           |
| ------------- | ------------------------------ |
| sent          | 接口返回成功                   |
| pending-audit | 等待平台审核，尚不能视为已投递 |

接口成功不等于客户端已显示。完整选项见 [消息 API](../api/messages.md)，服务主动发送见 [多机器人发送](./multi-bot.md)。
