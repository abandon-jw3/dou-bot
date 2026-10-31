# 向用户继续提问

需要补充文字、选择或下一条附件时，在命令或附件处理器中调用 `await ctx.prompt(...)`。按钮和原始事件上下文没有 prompt。

## 两轮输入

下面是 Controller 的方法；从 `dou-bot` 导入 Command、Ctx 和 MessageContext 类型：

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

- 每轮使用新回答的 `message.prompt()` 和 `message.reply()`，回复引用最近的输入。
- 已手动回复的流程返回 void，避免再自动发送一条返回值消息。
- 结果为 received、timeout 或 cancelled；只有 received 带 message。
- 图片或文件的 content 可能为空，仍是 received；附件通过 `message.attachments` 读取。
- 输入不符合要求时，回复后结束，或在有次数上限的流程里再次提问。文件筛选见 [附件指南](attachments-identity.md)。

## 超时与取消

```ts
const answer = await ctx.prompt('请输入信息：', {
  timeoutMs: 30000,
  cancelWords: ['取消', '/取消'],
});
```

- 默认等待 60 秒，从问题发送成功后计时；默认取消词为“取消”。
- 取消词去掉首尾空白后精确匹配；空数组表示禁用取消词。
- 应用级 `prompts` 可设置 timeoutMs、maxTimeoutMs、maxPending、cancelWords；默认最长 5 分钟，等待上限 1,000。
- 必须 await 完整流程；处理器结束或应用关闭后，不再使用旧上下文。

## 会话规则

- 等待按机器人、会话和用户隔离；其他用户、群或机器人的消息不会成为回答。
- 同一会话用户只能有一个等待项；重复等待报 `INVALID_STATE`。
- 已被 prompt 接收的回答不再触发命令、附件处理器或原始 On，即使它形似命令。
- 回答不会重新执行入口 Guard 或冷却；提交敏感操作前，按当前业务状态再核验权限。
- 等待时释放执行名额，但仍占会话资源；重启会清空对话状态。
- 群内是否需要 @ 机器人，以平台实际投递的事件为准。

## 测试对话

用 enqueue 发起命令 → 等问题出现 → enqueue 回答 → 等待流程完成。不要先 await 发起命令的 dispatch，它还在等待尚未发送的回答。具体示例见 [测试与排错](testing.md)。
