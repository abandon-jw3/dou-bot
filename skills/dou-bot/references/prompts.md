# 二次输入与会话

适用 dou-bot 0.6.0。`MessageContext.prompt(question, options?)` 发问并等待同一应用、会话和用户的下一条消息；不需要新装饰器。ButtonContext/QQEventContext 没有 prompt。

```ts
const answer = await ctx.prompt('请输入角色名，发送取消退出：', {
  timeoutMs: 60000,
  cancelWords: ['取消'],
});
if (answer.status !== 'received') return;
const next = await answer.message.prompt('请输入服务器：');
if (next.status !== 'received') return;
await next.message.reply(`${answer.message.content} / ${next.message.content}`);
```

片段在返回 Promise<void> 的命令处理器中使用，ctx 为 MessageContext。prompt 已手动发送问题，方法最后返回 void；不能再返回自动回复消息。

- 结果为 received（有 message）、timeout 或 cancelled。PromptMessage 是 MessageContext，可读取文字、附件和当前群消息 memberRole；空文字或图片不是超时。
- 每轮从新输入的 message.reply/message.prompt 回复，避免继续引用最初指令。所有输入上下文由原命令流程管理，共用 signal 与操作预算，结束后不能继续发送或等待。
- 默认 60 秒，从问题发送成功后计时；全局 prompts 支持 timeoutMs、maxTimeoutMs（默认 300000）、maxPending（默认 1000）、cancelWords（默认 ['取消']）。单次覆盖 timeoutMs/cancelWords，[] 禁用取消词，匹配去除首尾空白后的精确文本。
- 先注册后发送，快速输入被保留；发送失败时已捕获输入退回普通路由。被成功消费的回答不再执行 Command/On，即使文本看起来像指令；原指令 Guard/冷却不重跑。涉及管理操作时，在最终执行前用新输入角色或业务权限服务复核。
- 必须 await。一个会话用户只允许一个等待项，重复为 INVALID_STATE，超出容量为 RESOURCE_LIMIT；非法调用配置为 HANDLER_CONTRACT。关闭会中断等待，超时/用户取消则正常返回且不自动提示。
- 等待释放活跃执行槽，恢复前重新取得槽。回答仍受去重、字节及回复作用域限制；整个流程共用 maxContextOperations，每次 prompt 与发问题分别计数。不要用业务层全局 Map 代替这套生命周期。
- 交互测试通过 enqueue 驱动：发起命令、等问题记录出现、enqueue 回答、最后等待全部 done/flush。捕获输入的 done 与整段流程一起完成；多轮之间等待下一条问题记录，不能先 await 第一条回答的 dispatch。
- 群里无需 @ 的二次输入依赖 QQ 实际投递权限。离线测试通过不表示 QQ 客户端已经验证。
