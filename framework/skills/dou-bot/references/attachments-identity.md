# 接收附件与读取身份

## 选择接收方式

| 用户怎么发送                 | 使用方式                          |
| ---------------------------- | --------------------------------- |
| 指令与图片同条发送           | Command + Images                  |
| 指令后补发视频、音频或文件   | prompt 等待，再 selectAttachments |
| 直接上传符合名称或类型的文件 | OnAttachment                      |

装饰器、工具函数和类型均从 `dou-bot` 导入。以下方法放在已注册的 Controller 中。

## 同条指令与图片

```ts
@Command('收图')
receive(@Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[]): string {
  return `收到 ${images.length} 张图片。`;
}
```

- Images 选图片，Attachments 选全部附件；只选择当前消息，不等待补发。
- 默认允许空数组；必填用 minCount，上限用 maxCount，数量按筛选后的结果计算。
- Guard 先执行，数量错误不占冷却；命令错误提示由 `commands.invalidInput` 控制。

## 提问后收文件

在 MessageContext 处理器中使用：

```ts
const answer = await ctx.prompt('请发送 1 个文件，或发送“取消”。');
if (answer.status !== 'received') {
  await ctx.reply(answer.status === 'timeout' ? '等待超时。' : '已取消。');
  return;
}
const selected = selectAttachments(answer.message.attachments, {
  kind: 'file',
  minCount: 1,
  maxCount: 1,
});
if (selected.status === 'invalid') {
  await answer.message.reply('请发送 1 个文件；本次接收结束，请重新发起。');
  return;
}
await answer.message.reply(`收到文件：${selected.attachments[0]?.filename ?? '未提供名称'}。`);
```

- kind 支持 all、image、video、audio、file；视频和音频使用对应 kind。
- 数量不符返回 invalid，不自动回复或重问；非法配置才抛错。
- 使用回答消息的 reply，处理器返回 void；后续校验失败不会自动退还原命令冷却。
- 客户端是否能将文字与某类附件混发，以实际操作和机器人收件为准。

## 自动处理指定文档

```ts
@OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx', invalidInput: 'reply' })
receiveReport(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
  return `已接收：${files[0]?.filename}。`;
}
```

- filename 支持精确名称或正则，extension 匹配扩展名，kind 匹配分类；多个条件需在同一个附件上全部满足。
- `@OnAttachment()` 接收所有带附件的消息，纯文字不触发。
- Attachments 获得本处理器匹配的附件，Images 可进一步筛图；`ctx.attachments` 是整条消息的附件。
- 可用 Ctx、附件、身份和 ContextValue 参数；不支持 Arg、Slot 等文字参数。
- prompt 回答和已识别命令优先；多个附件处理器顺序执行，各自授权，某个失败不阻止其他处理器。
- 只允许处理一次时，使条件互斥或由业务服务协调；权限用 Guard，频率限制用 Cooldown。
- 附件数量错误由 OnAttachment 自己的 invalidInput 控制，默认 report；reply 才自动提示。
- 文件名匹配不代表内容有效；下载、大小限制、保存、解析交给业务 Service，并处理取消。

完整起点见 [附件模块](../assets/attachments-module.ts) 和 [测试](../assets/attachments-module.test.ts)。

## 类型识别范围

- 只看消息顶层 attachments，不递归引用消息，不从 URL 猜文件名或从文件名猜 MIME。
- MIME 忽略大小写、空白和参数；audio 兼容 QQ voice，file 兼容 QQ file 及其他合法的非图像/视频/音频 MIME。
- 未知类型仍可用 Attachments 读取；语音识别文本不会自动成为命令输入。

## 当前用户、群和角色

| 参数         | 注入值                                                     |
| ------------ | ---------------------------------------------------------- |
| `@User()`    | UserInfo：id，以及事件提供的可选 username、bot、memberRole |
| `@UserId()`  | 当前发送者或按钮操作者的 OpenID                            |
| `@Group()`   | GroupInfo，仅含 id；私聊为 undefined                       |
| `@GroupId()` | 群 OpenID；私聊为 undefined                                |
| `@Role()`    | member/admin/owner 或 undefined                            |

- 可用于 Command、OnButton、OnAttachment；这些数据只来自当前事件，不会查询完整资料。
- 对象只读，昵称可能缺失或为空；按钮不推断昵称或角色。
- 身份信息不代替授权，权限用法见 [权限与交互](runtime.md)。
- 保存用户配置时带上 ctx.appId、场景和 OpenID；群内独立配置还要区分群，不用日常 QQ 号代替。
