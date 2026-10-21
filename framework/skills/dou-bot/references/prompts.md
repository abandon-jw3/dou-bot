# 向用户继续提问

当一次操作需要补充信息或等待下一条附件时，在命令或附件处理器中使用 `await ctx.prompt(...)`。ButtonContext 和原始事件上下文没有 prompt。

## 完成两轮输入

下面是已有控制器中的方法，ctx 使用 MessageContext 类型：

```ts
@Command('登记')
async register(@Ctx() ctx: MessageContext): Promise<void> {
  const role = await ctx.prompt('请输入角色名，发送“取消”退出：');
  if (role.status !== 'received') {
    await ctx.reply(role.status === 'timeout' ? '等待超时。' : '已取消。');
    return;
  }

  const server = await role.message.prompt('请输入服务器：');
  if (server.status !== 'received') {
    await role.message.reply(server.status === 'timeout' ? '等待超时。' : '已取消。');
    return;
  }
  await server.message.reply(`登记信息：${role.message.content} / ${server.message.content}`);
}
```

从 dou-bot 导入 Command、Ctx，以及 MessageContext 类型。每轮使用新回答的 message.prompt/message.reply，回复就能引用最近的输入。prompt 已发送问题，处理器最终返回 void，不再额外返回自动回复消息。

## 处理结果和业务校验

结果有三种：received 带有 message，timeout 和 cancelled 没有。收到图片等附件时 content 可能为空，仍是 received；根据需求检查 message.content 或 message.attachments，不把空文字当作超时。

prompt 只接收下一条输入。输入不符合业务要求时，明确选择回复提示后结束，或在有次数上限的流程中再次提问。文件筛选见 [附件与身份](attachments-identity.md)。

等待绑定到同一应用、会话和用户，不同群或不同用户的消息不会成为回答。同一会话用户只能存在一个等待项；重复等待报 INVALID_STATE。成功作为回答的消息不会再触发普通命令、附件处理器或原始 On 观察器，即使它看起来像一条命令。

原入口的 Guard 和冷却不会在回答时重新执行。确认付款、管理等敏感业务前，按最新回答的身份或业务权限服务再次核验；不能只依赖最初发起时的权限。

## 设置超时和取消

默认等待 60 秒，从问题发送成功后计时；默认取消词为“取消”。单次可以指定：

```ts
const answer = await ctx.prompt('请输入信息：', {
  timeoutMs: 30000,
  cancelWords: ['取消', '/取消'],
});
```

取消词去除首尾空白后精确匹配；空数组表示禁用取消词。应用级 prompts 可以设置 timeoutMs、maxTimeoutMs、maxPending 和 cancelWords。默认最大等待时间为 5 分钟，同时等待上限为 1,000；根据业务交互数量配置。

等待期间会释放执行名额，但仍占用会话及相关资源。必须 await 整个流程；处理器结束或应用关闭后，不能继续用旧上下文发送或等待。重启会清空对话状态。

## 测试完整对话

用 enqueue 发起命令，等问题出现在测试消息中，再 enqueue 回答；多轮流程在下一条问题出现后继续。最后等待整个流程完成，不能先等待首条命令的 dispatch 才发送回答。具体测试方法见 [测试与排错](testing.md)。

群里不带 @ 的回答能否收到，取决于 QQ 是否向该机器人投递事件。离线测试验证业务流程，实际客户端收发需要另外确认。
