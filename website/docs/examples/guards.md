# 三级 Guard

此例中的 `USER_OPENID` 是占位值。连接真实群聊前，把它替换成该场景下允许用户的 OpenID。

| 调用                                | 结果                   |
| ----------------------------------- | ---------------------- |
| 私聊 /info                          | 模块级 Guard 拒绝      |
| 群聊 /info                          | 模块级放行             |
| 群聊 /settings                      | 还需通过类级允许名单   |
| 群聊 /change                        | 还需通过方法级群主检查 |
| 群聊 /limited 后立即 /limited-alias | 第二次被同一冷却拦截   |

这些命令只发送固定说明，不执行真正的群管理操作。群角色实际投递依赖 QQ 平台，缺失时拒绝。

## 源文件

### examples/guards/guards.ts

<<< @/../examples/guards/guards.ts

### examples/guards/app.module.ts

<<< @/../examples/guards/app.module.ts

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
node --env-file=.env .examples-build/examples/main.js guards
```

共享入口默认使用 WS 和 / 前缀。设置 QQ_TRANSPORT=webhook 可以切换接入，部署前阅读 [Webhook 指南](../guide/webhook.md)。按 Ctrl+C 关闭实例。

需要独立业务工程时，先完成 [快速开始](../guide/quick-start.md)，再替换 AppModule 和它依赖的文件；保留相应相对导入。

## 离线验收

执行 npm test，无需 QQ 凭证。对应断言包含在 [examples.test.ts](https://github.com/abandon-jw3/dou-bot/blob/main/website/tests/examples.test.ts)。这验证模块、解析和消息编码，不代表当前账号的平台权限或客户端显示已通过实机测试。
