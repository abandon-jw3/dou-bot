# 消息与按钮工具

从 dou-bot 导入 text、image、markdown、keyboard、button。它们构造消息对象；实际发送由命令返回值、上下文或 QQClient 完成。

## 消息助手

| API                         | 参数与默认                           | 返回            |
| --------------------------- | ------------------------------------ | --------------- |
| text(content)               | 文本字符串                           | TextMessage     |
| image(source, options?)     | ImageSource；options.caption 可选    | ImageMessage    |
| markdown(content, options?) | 原始 Markdown；options.keyboard 可选 | MarkdownMessage |
| keyboard(rows)              | 非空二维按钮数组；每行 1～5 个按钮   | Keyboard        |

MessageInput 是 string 或上述三类消息对象。ImageSource 是 HTTP(S) URL、Uint8Array 或 UploadedImage；字符串不表示文件路径。MarkdownBody 只支持原始 content，模板字段不属于本版 API。

<<< @/../examples/messages/app.module.ts

## 按钮构建器

| API                                         | 参数与默认                         | 返回           |
| ------------------------------------------- | ---------------------------------- | -------------- |
| button.link(label, url, options?)           | HTTP(S) URL，不带内嵌凭证          | KeyboardButton |
| button.command(label, command, options?)    | 命令文本；options.enter 默认 false | KeyboardButton |
| button.callback(id, label, data?, options?) | 回调 ID；data 默认空字符串         | KeyboardButton |

ButtonOptions 可指定 id、visitedLabel、style、permission。callback 的 ID 已经由首参提供，其 CallbackButtonOptions 不允许再指定 id。

- visitedLabel 默认为原 label；显式空字符串会保留。
- style 为 secondary（默认）或 primary。
- permission 默认为 everyone，也可为 users + userIds 或 managers。
- managers 仅支持群聊发送，角色限制的实机验证边界见 [访问限制](../guide/access.md)。

<<< @/../examples/buttons/app.module.ts

## MessageTarget 与发送选项

目标为 `{ scene: 'group', groupId }` 或 `{ scene: 'private', userId }`，身份均为对应场景的 OpenID。

RequestOptions 提供 signal、timeoutMs。SendOptions 在此基础上可提供 reply: `{ messageId, sequence }`。一般回复优先使用 ctx.reply，让框架管理引用和序号；手动传入引用时由调用者保证其属于正确会话。

## UploadedImage 与 SendResult

UploadedImage 记录 appId、apiOrigin、target、fileInfo，以及可选 fileUuid、expiresAt。只能在兼容的应用、环境、目标和有效期内使用，不能当成跨群通用媒体 ID。

SendResult 的 status 为 sent 或 pending-audit：前者有 messageId，后者有 auditId，可能尚没有 messageId。还可能提供 traceId、timestamp 或 raw。接口成功与客户端实际显示应分别确认。
