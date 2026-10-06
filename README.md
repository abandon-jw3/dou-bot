# dou-bot

面向 **QQ 官方机器人群聊和私聊** 的轻量 TypeScript 装饰器框架，支持 WS 与 Webhook。提供类似 NestJS 的模块、依赖注入和装饰器开发方式。

[完整中文用户文档](https://abandon-jw3.github.io/dou-bot/) · [公开示例与文档反馈](https://github.com/abandon-jw3/dou-bot/tree/main/website)

当前源码支持 Node.js **24.x（最低 24.0.0）**、ESM，TypeScript 使用 **5.9.3**。开发统一使用 24.21.0；SDK 的 CI 覆盖最低版本及开发版本。运行时只有 `reflect-metadata` 和 `ws` 两个直接依赖；使用 `tsc` 构建，不包含热更新或 Koishi 兼容层。

已发布的 `dou-bot@0.6.0` 元数据仍声明 Node.js `>=24`。源码中的 `<25` 上界将在后续发行中生效；使用 Node.js 25 及更高主版本的应用升级前需切换到支持的 24.x。

npm 包名是 **`dou-bot`**，GitHub 框架仓库也已改名为 `dou-bot`。npm 上的 `dd-bot` 属于其他项目，请使用下面的新导入名。

## 仓库结构

框架、业务示例与文档站统一维护在本仓库。三个工程独立安装依赖和构建；示例及文档使用已发布的 `dou-bot@0.6.0`。

在另一台设备继续开发时，先阅读 [跨设备开发交接](https://github.com/abandon-jw3/dou-bot/blob/main/docs/handoff.md)，其中包含环境恢复、凭证与技能配置、验收边界和后续工作。

| 位置                                                                          | 内容                                   | 常用命令（在仓库根目录执行） |
| ----------------------------------------------------------------------------- | -------------------------------------- | ---------------------------- |
| 根目录 `src/`、`tests/`                                                       | SDK 源码、测试和 npm 发包配置          | `npm run check`              |
| [apps/example](https://github.com/abandon-jw3/dou-bot/tree/main/apps/example) | 可独立使用的机器人初始项目与装饰器示例 | `npm run example:check`      |
| [website](https://github.com/abandon-jw3/dou-bot/tree/main/website)           | VitePress 中文文档站及文档示例         | `npm run docs:dev`           |

### 目录说明

以下列出仓库中纳入版本管理的目录，每个目录右侧标明职责：

```text
dou-bot/
├─ .github/                          # GitHub 仓库自动化配置
│  └─ workflows/                     # 三个工程的 Windows/Linux CI 与 Pages 部署
├─ apps/                             # 使用 SDK 的独立应用工程
│  └─ example/                       # 可作为新机器人起点的业务示例，独立安装 npm SDK
│     ├─ src/                        # 应用入口、根模块及最小 hello 命令
│     │  └─ example/                 # 带中文注释的全部装饰器、按钮与多轮输入示例
│     │     └─ module-guards/        # 模块、控制器类、方法三级 Guard 组合示例
│     ├─ tests/                      # 通过 dou-bot/testing 执行的离线业务测试
│     ├─ scripts/                    # 应用构建、测试及 SDK 来源校验脚本
│     └─ vendor/                     # SDK 版本、来源、完整性记录及升级说明
├─ docs/                             # SDK 指南、设计选型、API 审查、发布与验收记录
├─ examples/                         # 框架开发示例、QQ 联调探针、性能与持续运行测试
│  └─ business/                      # 面向 SDK 源码开发的模块化业务演示
├─ scripts/                          # SDK 构建、测试、API 契约、文档及发包校验脚本
│  └─ fixtures/                      # 用于验证兼容性的历史版本消费者代码
├─ skills/                           # 配套的 AI 开发技能
│  └─ dou-bot/                       # dou-bot 使用技能，调用名为 $dou-bot
│     ├─ agents/                     # 技能在工具中的展示与调用配置
│     ├─ assets/                     # 可复制的最小业务模块及离线测试
│     └─ references/                 # 模块、参数、权限、prompt 与测试的技能参考
├─ src/                              # dou-bot SDK 的 TypeScript 源码与公开入口
│  ├─ core/                         # 应用、模块与 DI，命令解析、权限、冷却和多轮输入
│  ├─ message/                      # 文本、图片、Markdown 和按钮的消息构造与校验
│  ├─ qq/                           # QQ HTTP API、令牌管理、客户端及事件标准化
│  ├─ testing/                      # dou-bot/testing 入口，提供离线测试应用与消息记录
│  └─ transport/                    # WS 与 Webhook 接入、心跳重连及回调验签
├─ tests/                            # SDK 的单元、协议、生命周期及回归测试
│  └─ fixtures/                     # 框架测试使用的辅助 Provider 等测试材料
└─ website/                          # 独立的 VitePress 文档工程，验证已发布的 npm SDK
   ├─ docs/                         # 网站页面、导航配置及静态资源
   │  ├─ .vitepress/                # 站点标题、导航、中文搜索与 Pages 路径配置
   │  │  └─ theme/                  # 默认主题扩展与自定义样式
   │  ├─ api/                       # 装饰器、应用、上下文、消息、客户端及类型参考
   │  ├─ examples/                  # 完整示例的讲解页面，引用实际可运行源码
   │  ├─ guide/                     # 安装、核心功能、QQ 接入、部署与排错教程
   │  └─ public/                    # favicon 等直接复制到站点产物的静态资源
   ├─ examples/                     # 文档引用并参与编译、测试的 TypeScript 示例
   │  ├─ access/                    # 群聊、私聊、用户与群角色访问限制
   │  ├─ buttons/                   # Markdown、按钮构造及点击回调
   │  ├─ client/                    # 注入并使用 QQClient 与 QQApi
   │  ├─ events/                    # 监听原始 QQ 事件
   │  ├─ guards/                    # 模块、类、方法三级 Guard 与冷却
   │  ├─ hello/                     # 最小命令、模块和依赖注入
   │  ├─ lifecycle/                 # 应用初始化与关闭时的资源管理
   │  ├─ messages/                  # 文本、图片与 Markdown 消息，以及图片测试数据
   │  ├─ prompt/                    # 等待用户二次输入、多轮问答与取消
   │  └─ query/                     # 无序 Slot、Rest、Option 与自定义 City 装饰器
   ├─ tests/                        # 文档示例的离线行为断言
   ├─ browser-tests/                # 桌面与手机端的导航、搜索、主题、复制及刷新测试
   └─ scripts/                      # 示例编译、公开 API 索引生成、内容与产物链接校验
```

开发机器人业务从 `apps/example/` 开始；修改框架实现时查看 `src/`、`tests/` 和根目录的 `examples/`；更新用户手册时修改 `website/docs/`，相应可运行代码放在 `website/examples/`。

### 本地与生成目录

下面这些目录不属于需要编辑的项目源码，部分仅在安装、构建或检查后出现：

| 目录                                        | 作用                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `.git/`                                     | 本地 Git 提交历史、分支及远程仓库配置。                              |
| `node_modules/`                             | 各工程安装的依赖；根目录、`apps/example/`、`website/` 各自维护一份。 |
| `dist/`、`apps/example/dist/`               | SDK 的 JavaScript 与类型声明，以及业务示例的 JavaScript 运行代码。   |
| `.test-build/`、`apps/example/.test-build/` | 执行离线测试前生成的 JavaScript 测试代码。                           |
| `coverage/`                                 | SDK 测试的覆盖率数据与报告。                                         |
| `work/`                                     | API 校验、发包消费者验证、性能测试等任务的临时文件与报告。           |
| `website/.examples-build/`                  | 文档示例及其离线测试的编译结果。                                     |
| `website/docs/.vitepress/dist/`             | 文档站的静态 HTML 与资源，用于预览和 Pages 部署。                    |
| `website/docs/.vitepress/cache/`            | VitePress 开发和构建时使用的缓存。                                   |

依赖、构建产物、缓存和临时目录已被 Git 忽略。清理构建产物后，需要重新执行相应构建命令再启动应用或预览文档。

开发整个仓库时，使用根目录 `.nvmrc` 声明的 Node.js 24.21.0 和 npm 11.19.0；CI 也从该文件读取 Node 版本。先运行 `npm run install:all`，再运行 `npm run check:all`。文档浏览器验收使用 `npm run docs:test:browser`；完整说明见 [仓库维护指南](https://github.com/abandon-jw3/dou-bot/blob/main/docs/repository.md)。只使用 SDK 时，按下面的安装步骤即可。

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

当前源码另新增 `Attachments`、`Images`、`Videos`、`Audios`、`Files` 五个附件参数装饰器，以及 `AttachmentOptions` 和语音附件扩展字段；这些 API **尚未包含在 npm 0.6.0 中**。源码开发可运行 `npm run example:attachments`，用法见 [附件参数](docs/command-parameters.md#附件参数未发布源码-api)。发布前，业务示例和文档站继续使用已发布包的 `ctx.attachments`。

源码还提供 `@User()`、`@UserId()`、`@Group()`、`@GroupId()`、`@Role()`，为命令及按钮注入当前事件的身份信息；缺失的群或角色信息为 `undefined`，不发起资料查询。这些装饰器及 `UserInfo`、`GroupInfo` **同样尚未发布**。运行 `npm run example:identity` 查看离线源码示例，完整类型和场景说明见 [身份参数](docs/command-parameters.md#身份参数未发布源码-api)。

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

WS 已有 Windows 和 macOS 的真实 QQ 群聊与私聊验证；Webhook 完成本地真实 HTTP、签名和双接入对照验证，**公网 QQ 回调尚待验收**。2026-10-06 已在本次机器人和测试群中验证群主、管理员、普通成员的角色字段与命令权限，以及管理者回调按钮的允许/拒绝路径；此结论不代表所有账号均有相同的投递能力。

队列、去重、冷却与 prompt 状态保存在单进程内。进程崩溃可能丢失已确认但未处理的任务；没有跨进程“恰好一次”保证。业务异步操作应配合上下文 signal，关闭期限不能硬终止任意用户 JavaScript。当前是 0.x 早期版本，升级时应核对 API 变更并锁定版本。

## 源码与许可

[源码仓库](https://github.com/abandon-jw3/dou-bot) 和 [独立示例项目](https://github.com/abandon-jw3/dou-bot/tree/main/apps/example) 现统一维护于本仓库。更多可运行示例见 [用户文档](https://abandon-jw3.github.io/dou-bot/examples/hello.html)。仓库中的 `skills/dou-bot` 为配套使用技能，调用名为 `$dou-bot`，其代码使用 `dou-bot` 包。

SDK、业务示例、文档及配套技能统一采用 [MIT 许可证](LICENSE)。适用的上游版权及许可保留在 [NOTICE](NOTICE) 中；业务示例和文档目录也包含可随独立副本分发的 LICENSE。
