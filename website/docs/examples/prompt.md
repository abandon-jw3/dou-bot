# 两轮问答

发送 `/报名`，按顺序输入角色名和服务器名称。最后一条回复引用第二轮的新消息。任一轮发送“取消”会结束流程。`/等待` 演示五秒超时。

群聊和私聊按各自会话隔离；同一个用户在不同群中可以分别等待。命令形状的文本也会作为回答消费。

离线测试使用 enqueue 发起流程、观察问题发送记录后投递回答，最后等待所有 done；完整驱动代码见下方测试链接。

## 源文件

### examples/prompt/app.module.ts

<<< @/../examples/prompt/app.module.ts

## 运行这个示例

克隆公开文档仓库后，在仓库根目录执行：

```sh
git clone https://github.com/abandon-jw3/dou-bot-docs.git
cd dou-bot-docs
npm ci
npm run examples:build
```

将 examples/.env.example 复制为根目录的 .env，填入自己的凭证。然后运行：

```sh
node --env-file=.env .examples-build/examples/main.js prompt
```

共享入口默认使用 WS 和 / 前缀。设置 QQ_TRANSPORT=webhook 可以切换接入，部署前阅读 [Webhook 指南](../guide/webhook.md)。按 Ctrl+C 关闭实例。

需要独立业务工程时，先完成 [快速开始](../guide/quick-start.md)，再替换 AppModule 和它依赖的文件；保留相应相对导入。

## 离线验收

执行 npm test，无需 QQ 凭证。对应断言包含在 [examples.test.ts](https://github.com/abandon-jw3/dou-bot-docs/blob/main/tests/examples.test.ts)。这验证模块、解析和消息编码，不代表当前账号的平台权限或客户端显示已通过实机测试。
