# dd-bot-example

使用 [dd-bot](https://github.com/abandon-jw3/dd-bot) 开发 QQ 官方机器人的最小初始项目。通过 WebSocket 接收群聊和私聊消息，只演示模块注册、命令装饰器、参数绑定和文本回复。

## 启动

环境：Node.js **24.21.0+**、npm **11.19.0**；项目固定使用 TypeScript **5.9.3**。

```sh
npm ci
```

复制 `.env.example` 为 `.env`，填入自己的机器人凭证：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
```

`.env` 已被 Git 忽略。然后编译并启动：

```sh
npm run build
npm start
```

向机器人私聊发送 `/hello`，或在机器人所在群中 @机器人发送该命令；群聊是否支持不 @ 取决于 QQ 是否向机器人投递消息。

| 发送          | 回复         |
| ------------- | ------------ |
| `/hello`      | 你好，朋友！ |
| `/hello 小明` | 你好，小明！ |

按 `Ctrl+C` 关闭连接。修改源码后重新运行 `npm run build` 并启动。

## 最简单的命令

[src/bot.controller.ts](src/bot.controller.ts)：

```ts
import { Arg, Command, Controller } from 'dd-bot';

@Controller()
export class BotController {
  @Command('hello')
  hello(@Arg(0) name = '朋友'): string {
    return `你好，${name}！`;
  }
}
```

`@Command('hello')` 注册命令，`@Arg(0)` 获取第一个参数；省略参数时使用默认称呼。方法返回的字符串会由框架自动回复。

[src/app.module.ts](src/app.module.ts) 使用 `@Module({ controllers: [BotController] })` 注册控制器，[src/main.ts](src/main.ts) 使用 `BotFactory.create()` 创建应用，再调用 `app.start()` 连接 QQ。

默认命令前缀为 `/`。如需直接发送 `hello`，在 `BotFactory.create()` 的配置中加入 `commands: { prefix: '' }`。

继续开发时，可以直接在 `BotController` 中添加命令方法；新增控制器后，将它加入 `AppModule` 的 `controllers`。

## 目录说明

```text
dd-bot-example/
├─ src/                       # 机器人源代码
│  ├─ main.ts                 # 读取凭证、创建应用、连接与关闭
│  ├─ app.module.ts           # 注册控制器的根模块
│  └─ bot.controller.ts       # hello 命令
├─ tests/                     # 使用 dd-bot/testing 的离线测试
│  └─ application.test.ts     # 验证私聊、群聊、默认参数和文本回复
├─ scripts/                   # 构建、测试和 SDK 校验脚本
│  ├─ tasks.mjs               # 清理旧产物，执行编译、测试与完整检查
│  └─ verify-sdk.mjs          # 检查 SDK 安装包及公开 API 导入
├─ vendor/                    # 固定版本 SDK 安装包、来源和校验信息
├─ .github/workflows/         # Windows / Linux 的 GitHub Actions 检查
├─ .env.example               # 本地凭证配置模板
├─ package.json               # 依赖和 npm 命令
├─ package-lock.json          # 锁定依赖版本
├─ tsconfig.json              # TypeScript 和装饰器配置
├─ tsconfig.build.json        # 应用编译配置
└─ tsconfig.test.json         # 测试编译配置
```

运行命令后生成的 `node_modules/`（依赖）、`dist/`（应用 JavaScript）和 `.test-build/`（测试 JavaScript）不提交到 Git。

项目使用 `tsc` 将 TypeScript 编译为 ESM JavaScript，输出到 `dist/`，由 Node.js 运行。保留传统装饰器和元数据编译配置；当前无需额外打包工具。

## 本地检查

```sh
npm test        # 离线验证命令，不需要 QQ 凭证或网络连接
npm run check   # SDK 校验、类型检查、Lint、格式检查、构建和测试
```

`npm run format` 可以统一格式。GitHub Actions 在 Windows 和 Linux 上执行相同的完整检查。

SDK 尚未发布到 npm，因此通过 `vendor/dd-bot-0.3.0.tgz` 安装，克隆本项目后即可安装依赖，无需本机另有框架源码。更新方式见 [vendor/README.md](vendor/README.md)。
