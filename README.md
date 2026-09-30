# dou-bot

面向 **QQ 官方机器人群聊和私聊** 的轻量 TypeScript 装饰器框架，支持 WS 与 Webhook。提供类似 NestJS 的模块、依赖注入和装饰器开发方式。

[完整中文用户文档](https://abandon-jw3.github.io/dou-bot-docs/) · [公开示例与文档反馈](https://github.com/abandon-jw3/dou-bot-docs)

运行环境为 Node.js 24+、ESM，TypeScript 使用 **5.9.3**。运行时只有 `reflect-metadata` 和 `ws` 两个直接依赖；使用 `tsc` 构建，不包含热更新或 Koishi 兼容层。

npm 包名是 **`dou-bot`**，GitHub 框架仓库也已改名为 `dou-bot`。npm 上的 `dd-bot` 属于其他项目，请使用下面的新导入名。

## 安装

[dou-bot@0.6.0](https://www.npmjs.com/package/dou-bot/v/0.6.0) 已发布。建议项目依赖锁定精确版本，在自己的机器人项目中运行：

```sh
npm init -y
npm pkg set type=module
npm install --save-exact dou-bot@0.6.0
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

也可通过 `dou-bot@next` 安装对应标签版本；标签可能随后续发行变化。旧本地 tgz 项目迁移时执行 `npm install --save-exact dou-bot@0.6.0`，并提交更新后的锁文件；代码仍从 `dou-bot` 导入。

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

框架使用传统参数装饰器和构造注入元数据。先用 `tsc` 编译再运行；不要用 Node 直接执行 TS 或默认不产生元数据的转译配置替代。业务无需额外安装 `@types/ws`。

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

私聊或在群中向机器人发送 `/hello 小明`，回复为 `你好，小明！`。`Ctrl+C` 关闭应用。群消息是否需要 @ 取决于 QQ 实际向该账号投递的事件；框架同时处理 `GROUP_AT_MESSAGE_CREATE` 与 `GROUP_MESSAGE_CREATE`。

默认前缀是 `/`，可配置为 `!`、`bot:` 或空字符串。`commands: { prefix: '' }` 允许直接发送 `hello 小明`；装饰器始终填写 `hello`，不带前缀。空前缀按消息开头的完整指令名匹配。

## API 与指南

下面的指南随 npm 包一起分发，可在 `node_modules/dou-bot/docs/` 中离线阅读。

| 能力                 | API / 文档                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 模块与依赖注入       | `@Module`、`@Injectable`、`@Inject`；支持类、值、异步工厂及 imports/exports 可见性                                  |
| 控制器与路由         | `@Controller`、`@Command`、`@On`、`@OnButton`                                                                       |
| 参数、无序匹配和帮助 | `@Arg`、`@Args`、`@Ctx`、`@Slot`、`@Rest`、`@Option`、`HelpModule`；[参数指南](docs/command-parameters.md)          |
| 权限和冷却           | `@UseGuards`、`@Cooldown`；[执行控制](docs/execution-controls.md)、[模块 / 类 / 方法 Guard](docs/module-guards.md)  |
| 场景、用户和角色限制 | `@GroupOnly`、`@PrivateOnly`、`@UsersOnly`、`@GroupRoles`、`@GroupManagersOnly`；[访问限制](docs/access-control.md) |
| 二次输入             | `ctx.prompt()` 支持超时、取消、附件、多轮输入；[二次输入指南](docs/prompts.md)                                      |
| 消息与按钮           | `text`、`image`、`markdown`、`keyboard`、`button`；原始 Markdown 与内联键盘，无需模板 ID                            |
| 框架服务             | `QQClient`、`QQApi`、`LOGGER` 可注入                                                                                |

模块 Guard 只覆盖本模块直接注册的控制器。执行顺序为模块 → 控制器类 → 方法 → 参数绑定 → 冷却 → 处理器；原始 `@On` 观察器不受该 Guard 链保护。

参数与返回值的完整类型由包入口提供。公开导入只有 `dou-bot` 和 `dou-bot/testing`；不依赖 `dist` 内部路径。调用 `ctx.reply()` 后返回 void，避免又通过返回值自动回复。

## 离线测试

测试入口运行真实模块、DI、参数解析与消息编码，在内存中替换网络，不读取 QQ 凭证。示例 `src/offline.ts`：

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

运行 `npx tsc -p tsconfig.json` 和 `node dist/offline.js` 即可验证。`messages` 保存模拟发送，`acknowledgments` 保存按钮确认，`errors` 收集错误；`dispatch()` 等待处理完成，`enqueue()` 可驱动二次输入场景。

## Webhook 与运行边界

将接入配置替换为下面的内容，由部署环境提供公网 HTTPS 入口：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

支持地址验证、Ed25519 原始字节验签、签名新鲜度检查、有界读取和去重。也可设置 `listen: false`，将 `app.webhookHandler()` 挂载到自有 Node HTTP server；保持原始路径和未读取的请求体，先完成 `app.start()` 再接入流量。

WS 已在 Windows 上完成真实 QQ 群聊和私聊验证；Webhook 完成本地真实 HTTP、签名和双接入对照验证，**公网 QQ 回调尚待验收**。群角色字段及管理者按钮对不同角色的实际拦截仍待专项实机验证。

队列、去重、冷却与 prompt 状态保存在单进程内。进程崩溃可能丢失已确认但未处理的任务；没有跨进程“恰好一次”保证。业务异步操作应配合上下文 signal，关闭期限不能硬终止任意用户 JavaScript。当前是 0.x 早期版本，升级时应核对 API 变更并锁定版本。

## 源码与许可

[源码仓库](https://github.com/abandon-jw3/dou-bot) 已公开；[历史独立示例](https://github.com/abandon-jw3/dd-bot-example) 仍需仓库访问权限。公开可运行示例见 [用户文档](https://abandon-jw3.github.io/dou-bot-docs/examples/hello.html)。仓库中的 `skills/dd-bot` 为配套使用技能，调用名仍是 `$dd-bot`，其代码使用 `dou-bot` 包。

采用 [MIT 许可证](LICENSE)。适用的上游版权及许可保留在 [NOTICE](NOTICE) 中。
