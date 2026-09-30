# 最小 hello

发送 `/hello 小明`，收到 `你好，小明！`；`/hello` 使用默认称呼，`/hi` 是同一个命令的别名。`/help hello` 显示帮助。

此例同时演示 Module、Injectable、Inject、Controller、Command 与 Arg；配置值使用 Symbol 令牌，构造服务使用值导入。

## 源文件

### examples/hello/greeting.service.ts

<<< @/../examples/hello/greeting.service.ts

### examples/hello/hello.controller.ts

<<< @/../examples/hello/hello.controller.ts

### examples/hello/app.module.ts

<<< @/../examples/hello/app.module.ts

## 运行这个示例

克隆主仓库后，进入 `website` 工程执行：

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/website
npm ci
npm run examples:build
```

将 `examples/.env.example` 复制为当前目录的 `.env`（即仓库中的 `website/.env`），填入自己的凭证。然后运行：

```sh
node --env-file=.env .examples-build/examples/main.js hello
```

共享入口默认使用 WS 和 / 前缀。设置 QQ_TRANSPORT=webhook 可以切换接入，部署前阅读 [Webhook 指南](../guide/webhook.md)。按 Ctrl+C 关闭实例。

需要独立业务工程时，先完成 [快速开始](../guide/quick-start.md)，再替换 AppModule 和它依赖的文件；保留相应相对导入。

## 离线验收

执行 npm test，无需 QQ 凭证。对应断言包含在 [examples.test.ts](https://github.com/abandon-jw3/dou-bot/blob/main/website/tests/examples.test.ts)。这验证模块、解析和消息编码，不代表当前账号的平台权限或客户端显示已通过实机测试。
