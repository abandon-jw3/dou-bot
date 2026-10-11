# 创建应用与组织业务服务

以下示例使用 dou-bot 0.7.0、Node.js 24.x、TypeScript 5.9.3 和 ESM。先检查用户项目的实际依赖和脚本；已有项目保留自己的目录结构与版本，新项目再补齐必要文件。

## 安装与编译

新项目安装 SDK：

```sh
npm install --save-exact dou-bot@0.7.0
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

已有项目先用 `npm ls dou-bot` 确认版本。业务从 `dou-bot` 导入，测试从 `dou-bot/testing` 导入；应用不需要另外安装 SDK 内部使用的类型或检出 SDK 源码。

package.json 设置 `"type": "module"`。下面是需要合并到项目中的编译选项：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "verbatimModuleSyntax": true,
    "strict": true
  }
}
```

参数装饰器和构造注入需要传统装饰器及运行时元数据。使用 tsc 编译后运行 JavaScript；若项目已有其他编译工具，确认它能保留这两项能力，不能仅凭能运行普通 TypeScript 推定 DI 可用。

相对导入沿用项目约定。NodeNext 项目可以写 `./service.js`，编译器会找到对应的 TypeScript 源文件；采用 `.ts` 导入的项目，在 TypeScript 5.9.3 中启用 `rewriteRelativeImportExtensions: true`。随附示例使用 `.js`，复制时按项目配置调整。

## 把一个功能放进模块

Controller 接收消息并组织回复，Service 负责查询、保存或计算，Module 注册它们：

```ts
import { Command, Controller, Inject, Injectable, Module } from 'dou-bot';

const SETTINGS = Symbol('settings');
interface Settings {
  label: string;
}

@Injectable()
class QueryService {
  constructor(@Inject(SETTINGS) private readonly settings: Settings) {}
  label(): string {
    return this.settings.label;
  }
}

@Controller()
class QueryController {
  constructor(private readonly service: QueryService) {}

  @Command('名称')
  name(): string {
    return this.service.label();
  }
}

@Module({
  providers: [QueryService, { provide: SETTINGS, useValue: { label: '查询' } }],
  controllers: [QueryController],
})
export class AppModule {}
```

把此模块加入应用根模块的 imports，或直接将它作为应用根模块。新增 Controller 要注册到 controllers；服务和自定义 Guard 要注册到 providers。

- 注入类时使用普通值导入；`import type` 会擦掉构造注入需要的信息。接口和配置对象通过 `@Inject(token)` 绑定。
- 共享服务由所属模块 exports，再由使用它的模块 imports；不要用 `new Service()` 绕过配置和生命周期。
- 异步初始化可用带 inject 的 useFactory，例如创建业务 API 客户端。工厂返回的服务仍按应用生命周期使用。
- 服务和 Guard 默认复用同一实例，不把当前用户或 ctx 放在实例字段中。
- 模块类用于声明依赖关系；业务状态放在 Service 中。需要从入口获取服务时使用 `app.get(Service)`。
- 发送能力、原始 QQ API 和日志分别可以注入 QQClient、QQApi、LOGGER；业务配置使用自己的令牌。

一组功能共用权限时，可在 Module 的 guards 或模块类上声明规则，作用于该模块的命令、按钮和附件处理器。详细用法见 [权限与交互](runtime.md)。

## 连接 QQ 与关闭应用

在应用入口读取本项目的环境配置，检查凭证后创建并启动：

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
await app.start();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.close().catch(() => {
      console.error('机器人关闭失败，请检查应用日志。');
      process.exitCode = 1;
    });
  });
}
```

本片段假设上一节模块保存在 app.module.ts。create 会检查配置、模块和路由，start 才开始接收事件；close 后不能重新启动同一实例。使用项目自己的 build/start 脚本，并在启动命令中明确加载本地 `.env` 或部署环境变量。

需要初始化数据库连接、缓存等资源时，让注册在 providers 中的 Service 提供 `onModuleInit(signal)` 和 `onModuleDestroy(signal)`，完成初始化与释放。用 useValue 传入的现有资源由应用自己关闭；业务请求应配合 signal 取消。

如果用户选用 Webhook，将 transport 配置为 `{ type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }`，再按部署环境提供 HTTPS 入口。集成到现有 HTTP 服务时使用 listen=false 与 `app.webhookHandler()`，在 app.start() 完成后接入流量，保留原始 URL 和未读取的请求体，不能先经过 JSON body parser；已有 HTTP 服务仍由应用负责关闭。
