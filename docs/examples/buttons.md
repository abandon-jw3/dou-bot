# Markdown 与按钮

发送 `/menu`，显示原始 Markdown 和三类按钮。点击“确认”进入 docs:confirm 回调，发送“确认成功。”；点击后的按钮文案仍保留。

本例默认 auto 确认，仅校验简单回调 data 并发送固定提示。需要真实业务授权时加入相应 Guard 和操作对象校验。平台对普通发送的权限限制仍然适用。

## 源文件

### examples/buttons/app.module.ts

<<< @/../examples/buttons/app.module.ts

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
node --env-file=.env .examples-build/examples/main.js buttons
```

共享入口默认使用 WS 和 / 前缀。设置 QQ_TRANSPORT=webhook 可以切换接入，部署前阅读 [Webhook 指南](../guide/webhook.md)。按 Ctrl+C 关闭实例。

需要独立业务工程时，先完成 [快速开始](../guide/quick-start.md)，再替换 AppModule 和它依赖的文件；保留相应相对导入。

## 离线验收

执行 npm test，无需 QQ 凭证。对应断言包含在 [examples.test.ts](https://github.com/abandon-jw3/dou-bot-docs/blob/main/tests/examples.test.ts)。这验证模块、解析和消息编码，不代表当前账号的平台权限或客户端显示已通过实机测试。
