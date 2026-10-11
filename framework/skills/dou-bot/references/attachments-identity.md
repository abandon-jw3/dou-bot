# 接收附件与读取身份信息

以下示例适用 dou-bot 0.7.0，装饰器、工具函数和类型都从 dou-bot 导入。先按用户的发送方式选择入口。

## 指令和图片在同一条消息里

```ts
@Command('收图')
receive(@Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[]): string {
  return `收到 ${images.length} 张图片。`;
}
```

这是控制器中的方法，需导入 Command、Images 和 Attachment 类型。Images 选择本条消息中的图片，Attachments 选择全部附件；默认允许没有匹配项，得到空数组。需要必填就配置 minCount，数量上限用 maxCount。数量校验在 Guard 后、冷却前，不会替用户等待下一条消息。

## 发出命令后，再单独发送文件

在已有 MessageContext 处理器中使用：

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

selectAttachments 支持 all、image、video、audio、file。正常数量不符返回 invalid，不自动发送提示；处理器决定结束还是重新提问。非法配置才抛错。使用回答消息的 reply 回复，并返回 void。

这种方式也适合单独发送的视频或音频。客户端是否能组合文字与附件，以用户实际可发送、机器人实际可接收的事件为准。

## 用户直接上传固定名称的文档

```ts
@OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx', invalidInput: 'reply' })
receiveReport(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
  return `已接收：${files[0]?.filename}。`;
}
```

方法需导入 OnAttachment、Attachments 和 Attachment 类型，并属于已注册的控制器。filename 可用精确名称或正则，extension 匹配扩展名，kind 匹配附件分类；配置多个条件时，同一个附件要全部满足。不写条件就接收所有带附件的消息，纯文字不会触发。

Attachments 注入本处理器匹配到的附件，Images 可继续选取其中的图片；ctx.attachments 则是整条消息的附件。可以使用 Ctx、附件和身份参数装饰器，不能在附件处理器上绑定文字参数。

正在等待的 prompt 和已经识别的命令优先。多个附件处理器匹配时，各自检查权限并按顺序执行；某个处理器拒绝、冷却或失败，不会自动取消其他处理器。若业务只应处理一次，让筛选条件互斥或在服务中明确协调。

附件入口的数量错误提示由 OnAttachment 的 invalidInput 控制，默认 report，可设为 reply；它与 commands.invalidInput 分开。需要限制上传者时使用 Guard，需要防重复调用时声明 Cooldown。

上述例子只确认收到文件。下载、保存、验证内容和解析 DOCX 放在业务服务中，配合取消信号及业务大小限制；文件名匹配不能证明内容一定有效。完整起点见 [附件模块](../assets/attachments-module.ts) 和 [测试](../assets/attachments-module.test.ts)。

## 筛选时实际使用什么信息

选择只看当前消息的顶层 attachments，不递归引用消息，不从 URL 猜文件名，也不从文件名猜 MIME。类型匹配忽略大小写、首尾空白和 MIME 参数；audio 兼容 QQ voice，file 兼容 QQ file 及其他合法的非图像/视频/音频 MIME。未知类型仍可用 Attachments 获取；语音识别文本不会自动变成命令输入。

## 获取当前用户、群和角色

| 参数         | 注入值                          | 业务用途                                       |
| ------------ | ------------------------------- | ---------------------------------------------- |
| `@User()`    | UserInfo                        | 当前发送者或按钮操作者的 ID 及本事件提供的资料 |
| `@UserId()`  | string                          | 关联业务记录或查询用户配置                     |
| `@Group()`   | GroupInfo 或 undefined          | 当前群的 ID；私聊为 undefined                  |
| `@GroupId()` | string 或 undefined             | 按群组织业务数据                               |
| `@Role()`    | member/admin/owner 或 undefined | 展示本次群消息中的角色信息                     |

这些参数可用于 Command、OnButton 和 OnAttachment。UserInfo 包含 id，以及可选的 username、bot、memberRole；GroupInfo 仅包含 id。对象只读，数据来自当前事件，不会自动查询完整资料。昵称可能缺失或为空；按钮事件只保证适用的用户/群 ID，不推断昵称或角色。

身份参数不替代授权。群管理操作使用 GroupManagersOnly 等规则；按钮权限见 [权限与交互](runtime.md)。保存用户配置时使用事件中的 OpenID，并明确会话或群的业务范围，不能拿日常 QQ 号或另一个场景的 ID 直接代替。
