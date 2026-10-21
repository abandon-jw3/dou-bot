# 快速开始

运行一个 QQ 机器人，发送 `/hello 小明`，收到“你好，小明！”。

## 1. 获取示例

准备 Node.js **24.21.0**、PostgreSQL，以及机器人的 AppID 和 AppSecret。

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/example
npm ci
```

- 以下命令都在 example 目录执行；你也可以将这个目录完整复制为自己的项目。
- 示例已配好 TypeScript **5.9.3**、装饰器和保存后重启。

## 2. 配置环境 {#环境配置}

复制 `.env.example` 为 `.env`，填写自己的 QQ 和数据库配置：

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

## 3. 初始化并运行

```sh
npm run build
npm run database:migrate
npm run dev
```

- 首次运行先初始化框架表；正常启动和保存后重启不自动迁移。
- 看到启动提示后，私聊发送 `/hello 小明`；群聊先 @机器人再发送。
- 保存代码后自动编译并重启；编译失败时保留上次成功版本。
- 按 Ctrl+C 关闭；生产运行使用 `npm run build` 和 `npm start`。

## 4. 修改第一个指令

打开 `src/bot.controller.ts`：

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
- 返回字符串会自动回复。修改回复文字、保存，再发送指令即可看到变化。
- 新增控制器时，在 `src/app.module.ts` 的 controllers 中注册。

## 接下来做什么

- `/example`：查看示例中的功能指令。
- [命令参数](./parameters.md)：读取选项、无序关键词和附件。
- [完整 hello 示例](../examples/hello.md)：将业务拆为 Controller、Service 和 Module。
- [多机器人](./multi-bot.md)：增加账号和后台通知。
- [离线测试](./testing.md)：不连接 QQ 验证业务。
- [部署](./deployment.md)：在服务器持续运行；没有回复时查 [排错指南](./troubleshooting.md)。
