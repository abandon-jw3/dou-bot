# dou-bot

一个轻量化的 TypeScript 机器人框架，面向 QQ 官方群聊和私聊，支持 WebSocket 与 Webhook。

**本页面向尚未发布的新版本。** 请从配套示例开始使用。

## 功能

| 功能         | 用法                                                                              |
| ------------ | --------------------------------------------------------------------------------- |
| 多机器人     | 一个应用共享业务服务，每个账号独立连接；[指南](docs/multi-bot.md)                 |
| 命令与参数   | Arg、Slot、Option、Rest、别名归一化和自动帮助；[指南](docs/command-parameters.md) |
| 图片与文件   | 同条图片、追问收附件、自动处理上传；[指南](docs/command-parameters.md#附件参数)   |
| 用户与群信息 | User、UserId、Group、GroupId、Role；[指南](docs/command-parameters.md#身份参数)   |
| 权限与冷却   | 内置限制、自定义 Guard、调用频率；[指南](docs/access-control.md)                  |
| 多轮对话     | 等待下一条输入，支持超时与取消；[指南](docs/prompts.md)                           |
| 上下文数据   | 异步准备、懒加载和类型化读取；[指南](docs/context-middleware.md)                  |
| 数据库       | PostgreSQL、共享连接池、持久化群地址；[指南](docs/database.md)                    |
| 运行监测     | 有界队列、取消、排空和容量快照；[指南](docs/capacity.md)                          |
| 阶段性能     | 可选耗时指标、采样执行链和有界导出；[指南](docs/diagnostics.md)                   |

## 运行第一个机器人

准备 Node.js **24.21.0**、PostgreSQL、QQ AppID 和 AppSecret。示例已配置 TypeScript **5.9.3**、ESM 和装饰器。

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/example
npm ci
```

复制 `.env.example` 为 `.env`，填写 QQ 与数据库配置：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=bot
DATABASE_NAME=bot
DATABASE_PASSWORD=your-database-password
```

```sh
npm run build
npm run database:migrate
npm run dev
```

- 首次运行先初始化框架表；普通启动不自动迁移。
- 私聊发送 `/hello 小明`，机器人回复“你好，小明！”。群聊先 @机器人。
- 保存代码后自动编译并重启；按 Ctrl+C 关闭。
- 生产环境用 npm run build、npm start。SDK 最低支持 Node 24.0.0，示例使用 24.21.0。

## 添加指令

修改示例中的 `src/bot.controller.ts`：

```ts
import { Arg, Command, Controller } from 'dou-bot';

@Controller()
export class BotController {
  @Command('hello')
  hello(@Arg(0) name = '朋友'): string {
    return `你好，${name}！`;
  }
}
```

- Command 注册指令；Arg 读取参数；返回字符串自动回复。
- 新增控制器时，在 AppModule 的 controllers 中注册。
- 业务组织与完整入口见 [快速开始](https://abandon-jw3.github.io/dou-bot/guide/quick-start.html)。

## 主动发送与账号选择

- 处理消息时返回内容或调用 `ctx.reply()`，由来源机器人回复。
- 外部 WS、定时任务使用 `MessageSender` 或 `BotManager`。
- 保存完整的 `ctx.target`，包含 `appId`、场景和 OpenID。
- 同一真实群在不同机器人下的 groupId 不同，不能互换使用。
- 具体调用方式见 [多机器人指南](docs/multi-bot.md)。

## Webhook

使用配套示例时，在 `.env` 中设置：

```dotenv
QQ_TRANSPORT=webhook
PORT=3000
```

- 默认回调路径为 `/qq/<AppID>`，公网 HTTPS 由部署环境提供。
- 自有 HTTP 服务使用 `webhook.listen: false` 和 `app.webhookHandler()`。
- 代理需保留原始请求体与签名头；先完成 `app.start()` 再接入流量。

## 离线测试

```ts
import { createMultiTestApplication } from 'dou-bot/testing';
import { AppModule } from './app.module.ts';

const h = await createMultiTestApplication(AppModule, { bots: [{ appId: 'demo' }] });
await h.app.start();
try {
  await h.dispatch('demo', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'm', content: '/hello 小明', author: { user_openid: 'u' } },
  });
  console.log(h.messages);
} finally {
  await h.app.close();
}
```

- 测试入口模拟 QQ 网络和框架持久化；业务 SQL、外部请求由自己的测试依赖替换。
- 群地址持久化到 PostgreSQL；消息任务、去重、冷却和 prompt 仍在内存中。
- 重要业务自行保证持久化与幂等，异步操作配合取消信号。

本地指南也可在安装后的 `node_modules/dou-bot/docs/` 阅读。

SDK、示例、文档和技能采用 [MIT](LICENSE)，上游声明见 [NOTICE](NOTICE)。
