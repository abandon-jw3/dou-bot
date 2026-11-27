# 快速开始

运行一个 QQ 机器人，发送 `/hello 小明`，收到“你好，小明！”。

## 1. 创建项目并安装

准备 Node.js **24.21.0**、PostgreSQL，以及机器人的 AppID 和 AppSecret。

```sh
mkdir my-qq-bot && cd my-qq-bot
npm init -y
npm pkg set type=module
npm install --save-exact dou-bot@1.1.0
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

- 按 [项目结构与编译](./project.md#typescript-配置) 创建 `tsconfig.json`，开启 `experimentalDecorators`、`emitDecoratorMetadata` 和 `rewriteRelativeImportExtensions`。
- 完整可运行目录见 [完整 hello 示例](../examples/hello.md)。

## 2. 配置环境 {#环境配置}

在项目根目录创建 `.env`，填写自己的 QQ 和数据库配置：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
DATABASE_HOST=127.0.0.1
DATABASE_PORT=5432
DATABASE_USER=bot
DATABASE_NAME=bot
DATABASE_PASSWORD=your-database-password
```

- 先在 PostgreSQL 中创建数据库和账号；填写已有的数据库名称。
- `.env` 只保存在自己的运行环境，不提交凭证。

## 3. 编写入口与第一个指令

创建 `src/bot.controller.ts`：

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

- `@Command('hello')` 注册指令，默认用 `/hello` 触发。
- `@Arg(0)` 读取第一个参数；没填写时使用“朋友”。
- 返回字符串会自动回复；新增控制器时注册到根模块的 `controllers`。
- `src/app.module.ts` 与 `src/main.ts` 完整写法见 [完整 hello 示例](../examples/hello.md)。

## 4. 初始化数据库并启动

```sh
npm run build
node --env-file=.env dist/migrate.js
npm start
```

- 首次运行先调用 `migrateDatabase(database)` 初始化框架表；正常启动不自动迁移。
- 启动后私聊发送 `/hello 小明`；群聊先 @机器人再发送。
- 按 Ctrl+C 优雅停机。

## 接下来做什么

- [命令参数](./parameters.md)：读取选项、无序关键词、`@Route()` 和附件。
- [完整 hello 示例](../examples/hello.md)：将业务拆为 Controller、Service 和 Module。
- [多机器人](./multi-bot.md)：增加账号和后台通知。
- [离线测试](./testing.md)：不连接 QQ 验证业务。
- [部署](./deployment.md)：在服务器持续运行；没有回复时查 [排错指南](./troubleshooting.md)。
