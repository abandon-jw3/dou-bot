# 创建和组织机器人项目

## 选择起点

- 新项目可复制 [业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/example)，进入应用目录运行 `npm ci`。
- 复制 `.env.example` 为 `.env`，填写 QQ 与 PostgreSQL 配置；先构建、执行数据库迁移，再启动应用。
- 已有项目沿用自己的目录、依赖版本和脚本，只添加需要的模块。
- 在已有 TypeScript 项目中安装本技能对应版本：`npm install --save-exact dou-bot@1.0.0-rc.0`。

## 编译配置

- Node 24.x；配套示例使用 Node 24.21.0、TypeScript 5.9.3、ESM。
- `package.json` 设置 `"type": "module"`；TypeScript 使用 `module: "NodeNext"`。
- 开启 `experimentalDecorators`、`emitDecoratorMetadata`、`strict`。
- 相对导入写 `.ts` 时开启 `rewriteRelativeImportExtensions`；随附 `.js` 导入由 NodeNext 解析到 TypeScript 源文件。
- 用 `tsc` 编译后运行 JavaScript；直接运行 TypeScript 不能代替装饰器编译。

## 模块与服务

| 内容                       | 放在哪里                                 |
| -------------------------- | ---------------------------------------- |
| 命令、按钮、文件接收入口   | Controller，并注册到模块的 `controllers` |
| 查询、渲染、文件处理等业务 | Service，并注册到 `providers`            |
| 跨模块共享服务             | 提供方 `exports`，使用方 `imports`       |
| 接口配置或外部依赖         | Symbol 令牌、`@Inject()` 和 Provider     |

- 注入类用值导入，接口和其他类型用 `import type`。
- Provider、Guard、中间件通常是共享单例；不要在字段上保存当前用户、群或 ctx。
- 可注入 `BotManager`、`MessageSender`、`GroupRoutes`、`Database`、`LOGGER`。
- 当前账号 API 用 `ctx.client`；后台选择账号用 `BotManager`，不直接注入 `QQClient/QQApi`。

可复制 [命令模块](../assets/minimal-module.ts) 和 [对应测试](../assets/minimal-module.test.ts)。它演示服务、配置注入、权限、参数和帮助。

## 启动与关闭

下面的 `AppModule` 是应用自己的根模块；环境变量先由应用配置层检查并加载。

```ts
import { AppFactory } from 'dou-bot';
import { AppModule } from './app.module.js';

const app = await AppFactory.create(AppModule, {
  database: {
    host: process.env.DATABASE_HOST!,
    user: process.env.DATABASE_USER!,
    database: process.env.DATABASE_NAME!,
    password: process.env.DATABASE_PASSWORD!,
  },
  bots: [{ appId: process.env.QQ_APP_ID!, secret: process.env.QQ_APP_SECRET! }],
  commands: { invalidInput: 'reply' },
});
const close = () => {
  app.close().catch(() => {
    process.exitCode = 1;
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
await app.start();
```

- 首次启动前单独调用 `migrateDatabase(database)`，见 [数据库用法](operations.md#数据库与-orm)。普通启动不自动建表。
- `create()` 准备配置；`start()` 连接数据库、创建服务并接入 QQ。
- 启动后可用 `app.get(Service)` 获取服务；`app.close()` 关闭整个应用，关闭后需创建新应用才能重启。

## 接入外部服务

| 时机                    | 钩子与用途                                              |
| ----------------------- | ------------------------------------------------------- |
| 数据库就绪、QQ 尚未启动 | `onModuleInit`：初始化业务资源                          |
| 可用账号就绪            | `onApplicationReady`：连接外部 WS、启动定时器           |
| 开始停止                | `onApplicationStopping`：停止新增任务，断开业务事件来源 |
| 在途工作排空后          | `onModuleDestroy`：释放资源                             |

各钩子支持异步处理；清理逻辑应能安全处理未完全启动的资源。通过 `useValue` 传入的资源由调用者管理。

## 改用 Webhook

- 账号声明 `transport: { type: 'webhook' }`；应用声明 `webhook: { host: '127.0.0.1', port: 3000 }`。
- 默认回调路径是 `/qq/<AppID>`，公网入口及平台回调地址由部署环境配置。
- 自有 HTTP 服务设置 `webhook.listen: false`，挂载 `app.webhookHandler()`；先完成 `app.start()` 再接收流量。
- 代理和 HTTP 中间件需保留 URL、签名头及未读取的原始正文。
