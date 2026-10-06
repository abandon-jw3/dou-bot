# 上下文与对话结果

上下文通过 `@Ctx()` 注入。类型名称与实际路由对应，不能混用。

## 公共事件信息

QQEventContext 提供 appId、eventName、可选 eventId、receivedAt、raw、signal、client。raw 是 QQDispatch，包含 op=0、事件名 t、事件数据 d，以及可选 id/s；d 默认 unknown。

把 raw 和 attachments 作为只读数据使用。业务自己的外部请求应 await 并传入 signal；回复当前消息时优先使用 ctx.reply，由框架处理消息引用和回复序号。

## MessageContext

MessageContext 为 GroupMessageContext 或 PrivateMessageContext。共同提供 messageId、userId、content、可选 timestamp、attachments、target，以及以下方法：

| 方法                       | 返回                        | 行为                                   |
| -------------------------- | --------------------------- | -------------------------------------- |
| reply(message)             | Promise&lt;SendResult&gt;   | 引用当前绑定消息，自动管理回复序号     |
| send(message)              | Promise&lt;SendResult&gt;   | 无引用发送，仍受平台权限限制           |
| prompt(question, options?) | Promise&lt;PromptResult&gt; | 发问并等待当前会话用户输入，必须 await |

通过 ctx.scene 区分 group/private。群消息上下文额外包含 groupId 和可能缺失的 memberRole；groupId 是群 OpenID，不是显示用群号。

content 是用于路由的正文；原始正文仍在 raw.d。只会移除明确匹配本机器人身份的开头提及，不会从任意文字推测 @ 对象。

## PromptResult 与选项

PromptOptions 包含 timeoutMs、cancelWords。默认来自全局 prompts 配置：60000ms、取消词“取消”，受全局 maxTimeoutMs 限制。

| status    | 可用数据               | 含义                                 |
| --------- | ---------------------- | ------------------------------------ |
| received  | message: PromptMessage | 新消息上下文，可继续 reply 或 prompt |
| timeout   | 无 message             | 期限内没有接收到输入                 |
| cancelled | 无 message             | 输入匹配取消词                       |

PromptMessage 是 MessageContext。取消与超时不自动发送提示；发送失败、重复等待、容量不足或关闭会拒绝 Promise。多轮回复优先使用最新返回的 message。见 [二次输入](../guide/prompts.md)。

## ButtonContext

提供 interactionId、userId、buttonId、data、scene、target，以及 ack(code?) 和 send(message)。ack 默认 code=0，返回 Promise&lt;void&gt;；send 返回 Promise&lt;SendResult&gt;。

群按钮的群标识读取 target.groupId。ButtonContext 没有 reply、prompt，也没有保证可用的群成员角色字段。data 是未解释的字符串，需要业务校验。

## GuardContext

提供请求与路由信息，包括 appId、eventName、raw、signal、userId、scene、target、controller、method、route。route 使用规范命令名或按钮 ID，不随别名变化。

kind=command 时有 messageId、content、attachments；kind=button 时有 interactionId、buttonId、data。群上下文有 groupId，群命令可能有 memberRole。

GuardContext 没有 reply/send/ack/client。canActivate 返回 true 放行，false 静默拒绝，或 `{ allow: false, message }` 拒绝并提示；不要返回 `{ allow: true }`。Guard 发生在参数绑定之前，因此没有解析后的 Slot 等参数。
