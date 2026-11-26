# 原始事件

`@On(eventName)` 按 QQ 事件名监听原始事件，适合统计和日志。

<<< @/../examples/events/app.module.ts

## 观察器与命令的关系

- 同一消息可先被 On 观察，再进入命令或附件处理器。
- 返回 `void`，不会自动回复；异常单独上报，不阻断后续命令。
- 不受模块、类 Guard 保护，也不能直接添加 Guard 或 Cooldown。
- prompt 已接收的回答不会进入观察器。

## 原始数据与类型

- 通过 `@Ctx()` 注入 `QQEventContext`，可读 eventName、raw、receivedAt、signal、client。
- `raw.d` 默认为 unknown，读取前先检查结构。
- 群普通消息为 GROUP_MESSAGE_CREATE，群 @ 消息为 GROUP_AT_MESSAGE_CREATE，私聊为 C2C_MESSAGE_CREATE。
- 注册观察器不会增加 QQ 账号的事件权限。
- 日志保留事件名、错误码和业务状态，避免记录完整正文或凭证。
