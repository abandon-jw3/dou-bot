# dou-bot-example

使用 [dou-bot](https://github.com/abandon-jw3/dou-bot) 开发 QQ 官方机器人的初始项目，通过 WebSocket 接收群聊和私聊消息。`/hello` 展示最简单的用法，独立的 `ExampleModule` 演示全部装饰器，并附有中文注释。

## 启动

环境：Node.js **24.x（最低 24.21.0）**、npm **11.19.0**；项目固定使用 TypeScript **5.9.3**。仓库开发版本由根目录 `.nvmrc` 指定。

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/apps/example
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
import { Arg, Command, Controller } from 'dou-bot';

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

## 全部装饰器示例

[src/example/](src/example/README.md) 中的独立模块覆盖 SDK 的 **20 个公开装饰器**，已通过 `AppModule.imports` 注册。发送 `/example` 或 `/示例` 查看入口，发送 `/help example-slot` 查看参数帮助。

示例包括构造注入、位置参数、选项、Slot/Rest、手动回复、类级和方法级 Guard、冷却、原始事件及按钮回调。每处声明都有中文注释，完整的装饰器索引和可复制命令见 [示例模块说明](src/example/README.md)。

如果只需要 `/hello`，移除 `AppModule` 中 `ExampleModule` 的导入和 `imports` 项即可。

模块、类和方法三级 Guard 的组合见 [module-guards/](src/example/module-guards/module-guards.module.ts)，可运行 `/example-module-info`、`/example-module-settings`、`/example-module-owner`。模块规则只保护该模块直接注册的控制器。

## 目录说明

二次输入示例位于 [example-prompt.controller.ts](src/example/example-prompt.controller.ts)：`/example-prompt` 演示角色名与服务器两轮输入，`/example-prompt-image` 接收图片，`/example-prompt-timeout` 演示 5 秒等待与取消。每一步都有中文注释。

```text
apps/example/
├─ src/                       # 机器人源代码
│  ├─ main.ts                 # 读取凭证、创建应用、连接与关闭
│  ├─ app.module.ts           # 注册控制器的根模块
│  ├─ bot.controller.ts       # 最小 hello 命令
│  └─ example/                # 全部装饰器的独立示例模块（含中文注释）
│     ├─ example.module.ts    # 模块组合、Provider 注册和服务导出
│     ├─ example.service.ts   # Injectable、Inject 与共享服务
│     ├─ example.guard.ts     # 群聊 / 私聊 Guard
│     ├─ example.controller.ts # 参数、上下文、方法级 Guard、冷却与按钮
│     ├─ example-access.controller.ts  # 内置场景、用户、群角色及管理者按钮
│     ├─ example-prompt.controller.ts  # 二次输入、多轮引用、图片和取消
│     ├─ module-guards/       # 独立模块的统一 Guard 与类/方法级组合
│     │  ├─ module-guards.module.ts     # providers 和模块 guards 配置
│     │  ├─ module-guards.controller.ts # 两个控制器与三级规则演示
│     │  └─ module-guards.guard.ts      # 模块、类和方法使用的 Guard
│     ├─ example-private.controller.ts # 类级 Guard
│     ├─ example-events.controller.ts  # 原始 QQ 事件观察器
│     └─ README.md            # 20 个装饰器索引和命令说明
├─ tests/                     # 使用 dou-bot/testing 的离线测试
│  ├─ application.test.ts     # 最小 hello 命令回归
│  ├─ access.test.ts          # 内置访问限制与管理者按钮
│  ├─ prompt.test.ts          # 通过 enqueue 驱动多轮交互测试
│  ├─ module-guards.test.ts   # 模块覆盖、层级顺序及导入隔离
│  └─ example.test.ts         # 全部装饰器示例的行为验证
├─ scripts/                   # 构建、测试和 SDK 校验脚本
│  ├─ tasks.mjs               # 清理旧产物，执行编译、测试与完整检查
│  └─ verify-sdk.mjs          # 检查 SDK 安装包及公开 API 导入
├─ vendor/                    # 已发布 SDK 的来源和校验记录（安装从 npm 下载）
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

`npm run format` 可以统一格式。主仓库的 [.github/workflows/ci.yml](../../.github/workflows/ci.yml) 在 Windows 和 Linux 上执行相同的完整检查。

本目录是独立 npm 工程，可以单独复制到新目录后安装和开发。请在本目录运行上述命令；主仓库根目录的 `npm run example:check`、`npm run example:build` 和 `npm run example:start` 是对应快捷入口。`.env` 放在 `apps/example/.env`。

SDK 已以 MIT 许可发布到 [npm](https://www.npmjs.com/package/dou-bot/v/0.6.0)。本项目锁定 `dou-bot@0.6.0`，从官方 registry 安装；无需本地 tgz 或另一份框架源码。来源及升级方式见 [vendor/README.md](vendor/README.md)。
