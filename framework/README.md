# dou-bot

一个轻量化的 TypeScript 机器人框架，面向 QQ 官方群聊和私聊，支持 WebSocket 与 Webhook。

**新版本尚未发布。** 本页从新建项目开始介绍用法；发行版本号另行确定。

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

## 新建项目

- Node.js **24.x**，最低 **24.0.0**。
- TypeScript **5.9.3**、ESM、传统参数装饰器。
- PostgreSQL 数据库；业务可以自行选择 ORM。

当前使用源码 tarball：在仓库的 framework 目录执行 `npm ci`、`npm run build`、`npm pack --ignore-scripts`。将生成的文件复制到业务项目，命名为 `vendor/dou-bot-source.tgz`。

```sh
npm init -y
npm pkg set type=module
npm install --save-exact ./vendor/dou-bot-source.tgz
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

创建 `tsconfig.json`：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  },
  "include": ["src/**/*.ts"]
}
```

## 编写指令

创建 `src/app.module.ts`：

```ts
import { Arg, Command, Controller, Module } from 'dou-bot';

@Controller()
class Commands {
  @Command('hello')
  hello(@Arg(0) name = '朋友'): string {
    return `你好，${name}！`;
  }
}

@Module({ controllers: [Commands] })
export class AppModule {}
```

创建 `src/main.ts`：

```ts
import { AppFactory, migrateDatabase } from 'dou-bot';
import { AppModule } from './app.module.js';

const database = {
  host: process.env.DATABASE_HOST!,
  user: process.env.DATABASE_USER!,
  database: process.env.DATABASE_NAME!,
  password: process.env.DATABASE_PASSWORD!,
};

if (process.argv.includes('--init-database')) {
  await migrateDatabase(database);
} else {
  const app = await AppFactory.create(AppModule, {
    database,
    bots: [{ appId: process.env.QQ_APP_ID!, secret: process.env.QQ_APP_SECRET! }],
  });
  const close = () => {
    app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await app.start();
}
```

在 `.env` 填入配置，并将它加入 `.gitignore`：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
DATABASE_HOST=127.0.0.1
DATABASE_USER=bot
DATABASE_NAME=bot
DATABASE_PASSWORD=your-database-password
```

```sh
npx tsc -p tsconfig.json
# 首次部署先初始化框架表；正常启动不会自动建表。
node --env-file=.env dist/main.js --init-database
node --env-file=.env dist/main.js
```

发送 `/hello 小明`，机器人回复“你好，小明！”。群聊是否需要 @机器人取决于账号实际投递权限。

## 主动发送与账号选择

- 处理消息时返回内容或调用 `ctx.reply()`，由来源机器人回复。
- 外部 WS、定时任务使用 `MessageSender` 或 `BotManager`。
- 保存完整的 `ctx.target`，包含 `appId`、场景和 OpenID。
- 同一真实群在不同机器人下的 groupId 不同，不能互换使用。
- 具体调用方式见 [多机器人指南](docs/multi-bot.md)。

## Webhook

账号配置接入方式，应用统一管理监听端口：

```ts
const app = await AppFactory.create(AppModule, {
  database,
  bots: [{ appId, secret, transport: { type: 'webhook' } }],
  webhook: { host: '127.0.0.1', port: 3000 },
});
```

- 默认回调路径为 `/qq/<AppID>`，公网 HTTPS 由部署环境提供。
- 自有 HTTP 服务使用 `webhook.listen: false` 和 `app.webhookHandler()`。
- 代理需保留原始请求体与签名头；先完成 `app.start()` 再接入流量。

## 离线测试

```ts
import { createMultiTestApplication } from 'dou-bot/testing';
import { AppModule } from './app.module.js';

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
