# 发送消息与图片

命令返回字符串或消息对象时，框架自动回复当前消息。希望逐步发送时使用 `await ctx.reply()` 并返回 void。

<<< @/../examples/messages/app.module.ts

图片示例的 [fixture-image.ts](https://github.com/abandon-jw3/dou-bot-docs/blob/main/examples/messages/fixture-image.ts) 在内存生成有效 PNG，不读取本地文件或访问外部图片服务。

## 选择发送方式

| 方式                                           | 引用和用途                                          |
| ---------------------------------------------- | --------------------------------------------------- |
| 命令返回消息                                   | 自动引用当前命令消息                                |
| ctx.reply(message)                             | 引用当前上下文绑定的消息，框架管理回复序号          |
| ctx.send(message)                              | 显式无引用发送，是否被平台允许取决于账号权限        |
| QQClient.sendMessage(target, message, options) | 从服务中按显式目标发送，可传 signal、超时和手动引用 |

使用当前上下文的方法时，要在处理器生命周期内 await。已经结束的上下文不能保存下来给定时任务继续用。

## 图片来源

`image(source, { caption? })` 接受 HTTP(S) URL、Uint8Array（包括 Node Buffer）或同一应用与目标下仍有效的 UploadedImage。字符串是 URL，不是磁盘文件路径；要发送本地文件，先用 Node 的 readFile 得到字节。

SDK 默认二进制上传上限为 10 MiB。平台还可能有独立格式、大小和发送频率限制；SDK 接受某个输入不等于平台一定投递成功。

UploadedImage 与应用、API 环境和发送目标绑定。不要把给一个群上传的媒体凭据直接发给另一个群或私聊，也不要长期保存过期凭据。

## 发送结果

SendResult 可能是 `sent` 或 `pending-audit`。后者表示等待平台审核，不应写成已经投递成功；即使是 sent，也表示接口返回成功，不等于用户已确认客户端显示。

消息助手及选项见 [消息 API](../api/messages.md)，从服务主动发送见 [QQClient](../api/client.md)。
