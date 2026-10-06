# 接收图片与文件

先按用户的发送方式选择入口：指令与图片同条发送时用 `@Images()`；机器人先提问、用户再发视频或文件时用 `ctx.prompt()`；用户直接上传文件时用 `@OnAttachment()`。这些 API 从 0.7.0 开始提供。

## 指令与图片同条发送

```ts
@Command('收图')
receive(@Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[]): string {
  return `收到 ${images.length} 张图片。`;
}
```

从 `dou-bot` 导入 Command、Images 以及 Attachment 类型，并将方法放进已注册的控制器。用户在同一条消息中发送 `/收图` 和图片；图片数量不符时处理器不会执行，也不占用冷却。配置 `commands.invalidInput: 'reply'` 可以回复输入提示。

`@Attachments()` 获取全部顶层附件，包括类型未知的附件；`@Images()` 选择 image MIME。两者的选项均为 name、description、minCount、maxCount，默认允许 0 个、数量无上限。不消费文字参数，可与 Arg、Slot、Rest、Option 以及身份参数混用。

## 先询问，再接收附件

视频、音频和文件可能无法与文字混合输入。先 `await ctx.prompt('请发送文件')`，确认结果为 received，再调用：

```ts
const result = selectAttachments(answer.message.attachments, {
  kind: 'file',
  minCount: 1,
  maxCount: 1,
});
if (result.status === 'invalid') {
  await answer.message.reply(`本条匹配 ${result.count} 个，请发送 1 个文件。`);
  return;
}
await answer.message.reply(`收到 ${result.attachments.length} 个文件。`);
```

kind 可为 all、image、video、audio 或 file。选择依据 MIME 和 QQ 的 voice/file 标记，忽略大小写及 MIME 参数，不根据文件名猜测分类。结果为 valid 或 invalid（too-few / too-many）；普通数量不符不抛异常、不自动发提示。非法配置属于 HANDLER_CONTRACT。成功数组与结果对象被冻结，附件对象沿用只读约定。

使用回答消息的 reply 引用刚收到的文件。示例在类型或数量不符时结束；重问、累计和处理多个文件由业务明确编写。超时与取消见 [多轮对话](./prompts.md)。

## 用户直接上传文件

```ts
@OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx' })
report(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
  return `已接收：${files[0]?.filename}。`;
}
```

这个处理器接收“报告_20261007.docx”一类文件，不要求用户先发指令。下载、验证和解析文档应交给自己的业务服务。

| 选项         | 匹配方式                                                      |
| ------------ | ------------------------------------------------------------- |
| filename     | 字符串精确匹配完整文件名，区分大小写；或按 RegExp 表达式匹配  |
| extension    | docx 或 .docx，忽略大小写，一个扩展名，不接受通配符或复合后缀 |
| kind         | 同 selectAttachments，默认 all                                |
| invalidInput | 默认 report；reply 为附件参数的数量错误额外发送提示           |

筛选条件必须同时命中同一个附件。省略条件时接收所有带附件的消息，纯文字不触发；缺少文件名时无法匹配 filename/extension。`@Attachments()` 注入此处理器匹配的集合，`@Images()` 再从该集合选择图片；`ctx.attachments` 保留本条消息的全部附件。

正在等待的 prompt 优先接收回答，已识别的命令也优先处理；命令被拒绝或失败后不会转交附件处理器。其他消息交给所有匹配的附件处理器，按发现顺序依次运行，各自独立检查 Guard 和冷却。多个条件重叠时都会执行；某个拒绝或失败不阻止其他处理器。处理器可以 await prompt，后面的处理器会等待本次追问结束。

处理器结束后其 Context 失效，未等待的追问会被清理；不要把 Context 保存在单例服务中供以后调用。参数可用 Ctx、Attachments、Images 和 [身份装饰器](./identity.md)，不支持文字参数装饰器，也不进入命令帮助列表。GuardContext 新增 attachment 分支和 matchedAttachments，见 [Guard](./guards.md)。

框架只接收 QQ 实际投递的顶层附件，不递归引用消息，也不从预览图或 ASR 文本合成输入。群聊中的独立文件是否投递取决于机器人账号权限；文件名符合 DOCX 不代表文件内容已经验证。

[运行完整附件示例](../examples/attachments.md)。
