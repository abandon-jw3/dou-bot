# 接收图片与文件

| 用户怎么发送           | 使用方式                               |
| ---------------------- | -------------------------------------- |
| 指令和图片同条发送     | `@Images()` 或 `@Attachments()`        |
| 先发指令，再单独发附件 | `ctx.prompt()` + `selectAttachments()` |
| 直接上传文件           | `@OnAttachment()`                      |

代码片段中的装饰器、工具和类型从 `dou-bot` 导入，方法放入已注册的控制器。

## 指令与图片同条发送

```ts
@Command('收图')
receive(@Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[]): string {
  return `收到 ${images.length} 张图片。`;
}
```

- 用户发送 `/收图` 并在同一条消息附上 1～4 张图片。
- `@Images()` 选择图片；`@Attachments()` 选择全部顶层附件，包括未知类型。
- 支持 `name`、`description`、`minCount`、`maxCount`；默认最少 0 个、数量无上限。
- 数量限制针对筛选结果；上下限必须是非负安全整数，且上限不小于下限。
- 数量不符时不执行处理器、不占冷却；`commands.invalidInput: 'reply'` 可回复提示。
- 可与文字和身份参数混用，不消费文字。

## 先询问，再接收附件

视频、音频和文件通常需要单独发送。在异步处理器中：

```ts
const answer = await ctx.prompt('请发送 1 个文件，或发送“取消”。');
if (answer.status !== 'received') return;

const result = selectAttachments(answer.message.attachments, {
  kind: 'file',
  minCount: 1,
  maxCount: 1,
});
if (result.status === 'invalid') {
  await answer.message.reply(`请发送 1 个文件，本条匹配 ${result.count} 个。`);
  return;
}
await answer.message.reply(`收到 ${result.attachments.length} 个文件。`);
```

| kind        | 匹配范围                                         |
| ----------- | ------------------------------------------------ |
| all（默认） | 全部附件，包括未知类型                           |
| image       | 具体的 image MIME，如 `image/png`                |
| video       | 具体的 video MIME                                |
| audio       | audio MIME 或 QQ 的 `voice` 标记                 |
| file        | QQ 的 `file` 标记，或其他合法 MIME，如 PDF、文本 |

- MIME 忽略大小写、首尾空白和类型参数；不根据文件名猜测。缺失、未知或 `image/*` 范围值仅进入 all。
- 默认 `minCount: 0`、无上限；要必填时设置 `minCount: 1`。
- `valid` 返回附件；`invalid` 返回 `reason`（too-few / too-many）、`count`、`limit`。
- 数量不符不抛异常、不自动提示、不截断数组；非法选项抛 `HANDLER_CONTRACT`。
- 结果和成功数组被冻结；保留顺序、重复项及附件对象引用，不修改原数组。
- 用 `answer.message.reply()` 引用新消息；重问和累计附件由业务自行编写。
- 后续回答不重新执行 Guard；校验失败不退还已占用的命令冷却。超时与取消见 [多轮对话](./prompts.md)。

## 用户直接上传文件

```ts
@OnAttachment({
  filename: /^报告_\d{8}\.docx$/iu,
  extension: 'docx',
  invalidInput: 'reply',
})
report(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
  return `已接收：${files[0]?.filename}。`;
}
```

用户直接发送“报告_20261007.docx”即可触发，无需先发命令。

| 选项         | 匹配方式                                                      |
| ------------ | ------------------------------------------------------------- |
| filename     | 完整文件名字符串，区分大小写；或 RegExp，完整匹配加 `^` / `$` |
| extension    | 单个扩展名，如 `docx` 或 `.docx`，忽略大小写                  |
| kind         | 与上表相同，默认 all                                          |
| invalidInput | 默认 report；reply 为附件数量错误回复提示                     |

- 所有条件必须命中同一附件；缺少文件名时无法匹配 filename/extension。
- 不支持扩展名通配符或复合后缀，也不从 URL 推断文件名。
- 省略条件时接收所有带附件的消息；纯文字不触发。
- `@Attachments()` 收到本处理器匹配的集合，`@Images()` 再筛选图片；`ctx.attachments` 仍是整条消息的附件。
- 支持 Ctx、附件和 [身份参数](./identity.md)、Guard、冷却及 prompt；不支持文字参数，不出现在命令帮助中。
- 附件路由的提示由自身 `invalidInput` 控制，与 `commands.invalidInput` 独立。

## 多个入口的优先级

1. 等待中的 prompt 先接收回答。
2. 已识别的命令先执行；拒绝或失败后也不转交附件处理器。
3. 其他消息交给所有匹配的附件处理器，各自执行一次。

- 多个处理器依次运行，独立检查权限和冷却；一个失败不阻止其余处理器。
- 顺序为导入模块在先、控制器按注册顺序、同一控制器内按方法名排序。
- `await ctx.prompt()` 结束后才继续下一个处理器，回答不会广播给其他处理器。
- 处理器结束后 Context 失效；不要保存到单例服务中稍后使用。

## 附件处理边界

- 只读取 QQ 实际投递的顶层附件，不读取引用附件或 ARK 预览图。
- 语音可提供 `voiceWavUrl`、`asrReferText`，ASR 文本不会自动变成命令。
- 文件名和 MIME 只是元信息；下载、校验内容、解析和保存交给自己的服务。
- 群聊独立文件是否投递取决于机器人账号权限。

[运行完整附件示例](../examples/attachments.md)。
