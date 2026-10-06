# 二次输入与多轮会话

需要先询问姓名、再收集其他信息时，可以在命令中使用 `ctx.prompt(question, options?)`。它向用户提问，并等待这个用户在当前会话中的下一条消息；其他用户的回答不会串入这次对话。

这种等待适合一次命令内的短对话，进程重启后不会恢复。需要长期保存的填写结果由你的业务存储管理。

## 使用方式

<<< @/../examples/prompt/app.module.ts

所有 prompt 都必须 await；处理器返回后，未完成的等待会以 INVALID_STATE 结束。提问本身是手动回复，所以处理器最后返回 void；不要再返回字符串触发第二次自动回复。

## API 与返回值

```ts
interface PromptOptions {
  timeoutMs?: number;
  cancelWords?: readonly string[];
}

type PromptMessage = MessageContext;
type PromptResult =
  | { readonly status: 'received'; readonly message: PromptMessage }
  | { readonly status: 'timeout' }
  | { readonly status: 'cancelled' };
```

question 接受已有的 MessageInput，包括文本和原始 Markdown。`received` 包含完整输入上下文：content、attachments、messageId、userId、target、raw，以及群消息可选的 memberRole。空文本或仅图片输入也是 received，不能通过 `if (!content)` 判断超时；具体输入格式由业务校验。

`message.reply()` 引用这条新输入，`message.prompt()` 以这条输入为下一轮问题的回复来源。原始 ctx 的字段保持原值。所有回答上下文与原命令共用 signal 和操作预算，在原命令结束前有效；结束后再次调用 reply/send/prompt 会拒绝，不能用于长期定时任务。

## 默认配置

```ts
const app = await BotFactory.create(AppModule, {
  appId,
  secret,
  prompts: {
    timeoutMs: 60000,
    maxTimeoutMs: 300000,
    maxPending: 1000,
    cancelWords: ['取消'],
  },
});
```

此片段假设 BotFactory、AppModule 与凭证已定义。配置对象和取消词会复制冻结。

| 配置         | 语义                                                         |
| ------------ | ------------------------------------------------------------ |
| timeoutMs    | 提问发送成功后开始计时，默认 60 秒；使用单调时钟             |
| maxTimeoutMs | 每次等待的最长允许时间，默认 5 分钟；不超过 2147483647 毫秒  |
| maxPending   | 每个应用最多 1000 个等待项，包含问题发送中和等待恢复的项     |
| cancelWords  | 对去除首尾空白后的输入精确、区分大小写匹配；空数组禁用取消词 |

每次调用可覆盖 timeoutMs 和 cancelWords。配置 maxTimeoutMs 小于 60 秒且未指定全局 timeoutMs 时，默认时间取 maxTimeoutMs。未知选项、非法时间、空取消词会拒绝；全局配置错误为 CONFIG，调用参数错误为 HANDLER_CONTRACT。

发送问题仍受 api.requestTimeoutMs 限制。等待计时从 QQ 发送请求成功返回后开始，不包含提问请求用时，也不保证客户端此时已经展示消息（例如消息审核中）。快速回答会先保留，问题发送成功后才交给业务；提问失败时，已经保留的输入退回普通路由处理。

## 匹配与消费

- 私聊按用户匹配；群聊还必须匹配群和用户。同一个用户在不同群或私聊中的输入互不影响，各应用的等待表独立。
- 不做跨场景 OpenID 转换。同一会话用户只能有一个等待项，重复登记抛 INVALID_STATE，保留原等待；达到 maxPending 抛 RESOURCE_LIMIT，均在发送额外问题前拒绝。
- 捕获下一条消息，不做指令解析。即使输入是 `/help` 也会作为回答；取消词优先识别。被捕获的消息不再进入 Command 或 On 观察器。超时后到达的消息照常路由。
- 回调按钮事件不能满足消息等待。首版只在 MessageContext 提供 prompt；ButtonContext 和原始 QQEventContext 没有此方法。
- Guard 与冷却在原指令入口执行一次，后续回答不会重跑或重新扣除冷却。管理操作应在实际执行前依据新输入的 memberRole 或业务权限服务复核权限，不长期沿用开始时的角色。
- 取消和超时正常返回，不自动发送结束提示。发送失败、重复等待、资源不足和关闭中断会拒绝 Promise；错误沿用现有上报机制，等待器错误的 phase 为 prompt，发送错误仍为 send。
- QQ 群聊是否投递普通消息取决于平台权限；框架只能接收 QQ 实际送达的回答，必要时用户仍需 @机器人。

## 并发、引用与关闭

等待期间保留父任务，但释放活跃执行槽。回答匹配发生在普通命令过滤/排队之前，并保留正常的校验、去重、字节和回复作用域限制；恢复业务前通过原 FIFO 队列重新取得执行槽。因此多个等待者不会占满 concurrency，后续业务也不会突破并发上限。

回答被捕获后由父流程持有，各自的消息 ID、回复序号和去重记录持续有效，直到整个流程结束。普通群事件与群 @ 事件按同一个消息身份去重。重复投递不能满足第二轮等待，也不会重复回复。

maxPending 是等待项上限，实际可用容量还受 queueMaxBytes、maxEventBytes、dedupMaxEntries 和 replyScopeMaxEntries 约束。整个流程共用 maxContextOperations：每次 prompt 和发送问题分别占一个操作，后续 reply/send 也计数。普通队列满时仍为匹配回答保留接纳路径，字节或其他资源不足仍返回 overloaded，且不会消费等待项。

关闭开始时停止接收、取消等待、撤销计时器并中断相应 signal。等待恢复的流程仍受统一关闭期限约束；超时强制清理不会重新运行后续业务。任意用户 JavaScript 仍须配合 signal，框架无法硬终止不协作的代码。

## 离线测试

交互测试先用 `harness.enqueue()` 发起命令，等待模拟发送记录出现后，再 enqueue 回答；最后等待这些接纳结果的 done 或调用 flush。直接顺序 `await harness.dispatch(首条事件)` 再发送回答，会把测试驱动卡在尚未完成的会话上。

捕获回答的 done 与父流程一起完成，不能用它等待“第一轮已处理”再驱动第二轮；应观察下一条问题发送记录。完整运行与测试方法见 [两轮问答示例](../examples/prompt.md)。

连接 QQ 试用时，分别检查私聊和群聊的正常回答、取消与超时。如果群聊普通消息没有进入下一轮，先试着 @机器人回复，再检查该账号的消息投递权限。
