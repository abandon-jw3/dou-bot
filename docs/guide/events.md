# 原始事件

`@On(eventName)` 按精确的 QQ 事件名注册观察器，用于统计、记录或处理 SDK 高层命令之外的事件。

<<< @/../examples/events/app.module.ts

## 观察器与命令的关系

同一条可处理消息可以进入对应 On 观察器以及命令处理器。观察器异常单独上报，不应阻断对应命令；观察器必须返回 void，不会自动发送返回值。

模块和控制器上的 Guard 不保护原始 On 观察器；不能在 On 方法上声明 Guard 或 Cooldown。敏感操作应放在明确执行权限检查的业务入口中。

prompt 已消费的后续回答属于已有流程，不再进入 On 或 Command。

## 原始数据与类型

QQEventContext 提供 eventName、raw、receivedAt、signal、client 等信息。raw.d 默认是 unknown，访问平台字段前先检查输入结构；类型断言不能替代校验。

群聊普通消息和 @ 消息的事件名不同；私聊使用 C2C_MESSAGE_CREATE。仅注册 On 并不会自动申请额外的平台事件权限。

记录日志时优先保存事件名、错误码和业务状态，避免记录完整消息正文、凭证或身份信息。
