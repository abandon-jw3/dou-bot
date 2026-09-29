# 工程、模块与依赖注入

适用基线：dd-bot 0.3.0。先检查项目实际声明，保留现有结构与用户选定的版本。

## 消费 SDK

公开入口只有 `dd-bot` 和 `dd-bot/testing`。根入口加载 reflect-metadata/lite；业务无需添加框架内部的 RuntimePorts、Container 或 WebSocket 类型依赖。

目前框架保持 private。已有项目使用本地 SDK tgz 时，保留 vendor 包、来源提交、SHA-256 和 package-lock.json；不要替换成不明来源的同名 npm 包。参考消费者的依赖形式是 `"dd-bot": "file:vendor/dd-bot-0.3.0.tgz"`，路径和版本应按实际包调整。

业务开发依赖通常包含 TypeScript 与 @types/node，生产依赖只需声明自己使用的 SDK 和业务库。框架内部的 ws 不意味着消费者必须安装 @types/ws。

## 编译条件

核心 tsconfig 选项如下；合并进项目现有配置，而非覆盖其他选项：

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "verbatimModuleSyntax": true,
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true
  }
}
```

package.json 使用 `"type": "module"`，相对 TS 导入采用生成后的 `.js` 扩展名。用 tsc 生成并运行 JS；不要假定 Node 直接运行 TS、tsx 或默认 SWC/esbuild 配置会产生构造注入所需的传统装饰器元数据。

## 模块与 Provider

```ts
import { Command, Controller, Inject, Injectable, Module } from 'dd-bot';

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

- 被自动注入的类必须作为运行时值导入，不能用 `import type`。接口、字符串、原始类型或函数依赖用 `@Inject(token)`；不要期待 Object/String/Number 元数据映射到业务服务。
- Provider 支持类、useClass、useValue 和带 inject 的异步 useFactory。类单例及工厂结果按模块图初始化。
- 可见性由所属模块的 providers、imports 和 exports 决定。共享服务要由其模块导出，再由消费者模块导入。Controller 不作为 Provider 注入或跨模块导出。
- QQClient、QQApi、LOGGER 是保留的内置可注入令牌，不能用普通 providers 覆盖。
- 模块类仅承载声明，不自动实例化。继承带依赖的构造函数时，派生类应明确声明构造和注入；不要依赖被擦除的类型自动继承。
- `app.get(Service)` 读取根模块可见服务；有需要时使用 `app.get(Service, { module: FeatureModule })`。不要绕过模块可见性直接构造另一份单例。

## 创建、启动和关闭

```ts
import { BotFactory } from 'dd-bot';

const app = await BotFactory.create(AppModule, {
  appId: process.env.QQ_APP_ID!,
  secret: process.env.QQ_APP_SECRET!,
  transport: { type: 'ws' },
  commands: { prefix: '/', invalidInput: 'reply' },
});
await app.start();
// 宿主退出时调用并等待 app.close()。
```

此片段假设业务 AppModule 已定义，实际入口先检查凭证是否存在。create 完成配置、DI 和路由检查；start 才建立接入。close 之后不能重启同一应用实例。

`OnModuleInit.onModuleInit(signal)` 和 `OnModuleDestroy.onModuleDestroy(signal)` 可同步或异步。自行创建的资源按生命周期释放；useValue 的资源归调用者所有，不会被框架自动销毁。异步业务应响应 signal，框架无法硬终止任意用户 JavaScript。

Webhook 可选：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

也可配置 listen=false 后挂载 `app.webhookHandler()`。保持原始 URL 和未读取的请求体，先完成 start 再接入流量。不要在处理器前用 JSON body parser 消耗签名原文；嵌入模式的 HTTP server 生命周期由宿主管理。

业务 HTTP 请求传入上下文 signal，并使用适合业务的超时/缓存；框架不会替你 await 注入服务发起的任意网络操作。Node 的代理行为按目标版本和现有脚本核实；使用 --use-env-proxy 的已验证消费者采用 Node 24.21.0，不把该开关假定为所有 Node 24 小版本均可用。
