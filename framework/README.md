# dou-bot

面向 QQ 官方群聊和私聊的轻量 TypeScript 机器人框架，支持 WebSocket 与 Webhook。

[中文用户文档](https://abandon-jw3.github.io/dou-bot/) · [完整业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/example)

## 主要功能

| 功能         | 用法                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------- |
| 命令与参数   | Arg、Slot、Rest、Option 和自动帮助；[参数指南](docs/command-parameters.md)                               |
| 图片与文件   | 同条图片、追问收附件、直接上传；[附件指南](docs/command-parameters.md#附件参数)                          |
| 用户与群信息 | User、UserId、Group、GroupId、Role；[身份参数](docs/command-parameters.md#身份参数)                      |
| 权限与频率   | 内置限制、自定义 Guard、冷却；[访问限制](docs/access-control.md)、[执行控制](docs/execution-controls.md) |
| 多轮对话     | 等待下一条输入，支持超时与取消；[prompt](docs/prompts.md)                                                |
| 消息与按钮   | 文字、图片、原始 Markdown、内联按钮                                                                      |
| 组织业务     | Module、Controller、Service 与依赖注入                                                                   |
| 离线测试     | 用 dou-bot/testing 测试自己的业务，无需 QQ 凭证                                                          |

## 安装

- SDK：**dou-bot 0.7.0**，使用精确版本和锁文件。
- 环境：Node.js **24.x**（最低 **24.0.0**），教程使用 **24.21.0**。
- 编译：TypeScript **5.9.3**、ESM、传统参数装饰器。
- 运行依赖：reflect-metadata、ws。

在自己的项目中执行：

```sh
npm init -y
npm pkg set type=module
npm install --save-exact dou-bot@0.7.0
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
    "emitDecoratorMetadata": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"]
}
```

- 保留 experimentalDecorators、emitDecoratorMetadata。
- 先用 tsc 编译，再由 Node 运行生成的 JavaScript。
- 业务只从 `dou-bot`、测试只从 `dou-bot/testing` 导入。

## 最小机器人

创建 `src/app.module.ts`：

```ts
import { Arg, Command, Controller, Injectable, Module } from 'dou-bot';

@Injectable()
class Greetings {
  hello(name: string): string {
    return `你好，${name}！`;
  }
}

@Controller()
class Commands {
  // 自动构造注入需要运行时的类，拆分文件时也应使用值导入。
  constructor(private readonly greetings: Greetings) {}

  @Command('hello', { aliases: ['hi'] })
  hello(@Arg(0) name: string = '朋友'): string {
    // 返回值由框架自动回复。
    return this.greetings.hello(name);
  }
}

@Module({ providers: [Greetings], controllers: [Commands] })
export class AppModule {}
```

创建 `src/main.ts`：

```ts
import { BotFactory } from 'dou-bot';
import { AppModule } from './app.module.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('请配置 QQ_APP_ID 和 QQ_APP_SECRET');

const app = await BotFactory.create(AppModule, {
  appId,
  secret,
  transport: { type: 'ws' },
  commands: { prefix: '/', invalidInput: 'reply' },
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
console.log('机器人已启动');
```

在本地 `.env` 填入凭证，并将 `.env` 加入项目的 `.gitignore`：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
```

编译并启动：

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

- 发送 `/hello 小明`，收到 `你好，小明！`。
- `/hi` 是别名；省略名字时回复“朋友”。
- 群聊先 @机器人；不 @ 是否可用取决于账号投递权限。
- 默认前缀为 `/`，可通过 `commands.prefix` 改为其他字符串或空字符串。
- `Ctrl+C` 关闭应用；手动 `ctx.reply()` 后返回 void，避免重复回复。

## 离线测试

创建 `src/offline.ts`：

```ts
import assert from 'node:assert/strict';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from './app.module.js';

const testBot = await createTestApplication(AppModule);
await testBot.app.start();
try {
  await testBot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'test-message', author: { id: 'test-user' }, content: '/hello 小明' },
  });
  assert.equal(testBot.messages[0]?.payload.content, '你好，小明！');
  assert.equal(testBot.errors.length, 0);
} finally {
  await testBot.app.close();
}
```

```sh
npx tsc -p tsconfig.json
node dist/offline.js
```

- messages 记录模拟发送，acknowledgments 记录按钮确认，errors 收集错误。
- dispatch 等待当前处理完成；prompt 交互用 enqueue 驱动。
- 自己的数据库或外部请求需通过业务依赖替换。

## Webhook 与运行边界

使用 Webhook 时替换 transport，并由部署环境提供 HTTPS：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

- 也可用 `listen: false`，将 `app.webhookHandler()` 挂载到自有 Node server。
- 保留原始请求体和签名头，完成 app.start 后再接入流量。
- 公网 QQ 回调尚未完成端到端验证，接入步骤见 [Webhook 指南](https://abandon-jw3.github.io/dou-bot/guide/webhook.html)。
- 队列、去重、冷却和 prompt 保存在单进程，重启后重置。
- 重要业务自行持久化和幂等处理；外部异步任务配合 Context 的 signal。

## 未发布功能

以下仅存在于当前源码，**npm 0.7.0 不支持**：

| 功能           | 使用说明                                                                        |
| -------------- | ------------------------------------------------------------------------------- |
| Slot.normalize | 将匹配到的别名统一为规范值；[归一化](docs/command-parameters.md#slot-归一化)    |
| 上下文中间件   | 异步准备、懒加载、ctx.state 和 ContextValue；[指南](docs/context-middleware.md) |
| 容量监测       | snapshot 新增 capacity、rejections、timing；[容量指南](docs/capacity.md)        |

## 更多资料

- [模块级权限](docs/module-guards.md)
- [源码开发](https://github.com/abandon-jw3/dou-bot/blob/main/framework/docs/contributing.md)：SDK 命令在 framework 目录运行。
- [dou-bot 技能](https://github.com/abandon-jw3/dou-bot/tree/main/framework/skills/dou-bot)：辅助开发机器人业务。

本页链接的本地指南也可在安装后的 `node_modules/dou-bot/docs/` 阅读。

SDK、示例、文档和技能采用 [MIT](LICENSE)，上游声明见 [NOTICE](NOTICE)。
