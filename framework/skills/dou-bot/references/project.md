# 项目与服务

## 安装与编译

- 新项目可复制 [业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/example)，在应用目录运行 npm ci。
- 复制 .env.example 为 .env，填写 QQ 与 PostgreSQL 配置；首次运行先初始化数据库。
- Node 24.x、TypeScript 5.9.3、ESM；已有项目沿用自己的结构和运行脚本。
- 开启 experimentalDecorators、emitDecoratorMetadata、strict。
- 相对导入用 .ts 时开启 rewriteRelativeImportExtensions；随附 .js 导入也可由 NodeNext 解析到源码。

## 组织代码

- Module 注册 controllers/providers；共享服务用 exports/imports。
- Controller 接收命令、按钮或附件；Service 查询与处理数据。
- Provider、Guard 和中间件通常是应用单例，多账号共用；不要在实例字段保存当前用户或 ctx。
- 注入类用值导入；接口配置用 Symbol 与 Inject。
- 内置注入令牌：BotManager、MessageSender、GroupRoutes、Database、LOGGER。
- QQClient/QQApi 通过选定账号或 ctx.client 获取，不直接构造注入。

可复制的 [命令模块](../assets/minimal-module.ts) 包含服务、配置、Guard、参数和帮助；配套 [测试](../assets/minimal-module.test.ts)。

## 启动

下面的 AppModule 由用户项目提供；环境变量在应用启动前检查：

```ts
import { AppFactory, migrateDatabase } from 'dou-bot';
import { AppModule } from './app.module.js';

const database = {
  host: process.env.DATABASE_HOST!,
  user: process.env.DATABASE_USER!,
  database: process.env.DATABASE_NAME!,
  password: process.env.DATABASE_PASSWORD!,
};
if (process.argv.includes('--init-database')) {
  await migrateDatabase(database);
} else {
  const app = await AppFactory.create(AppModule, {
    database,
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
}
```

- create 校验配置和模块图；start 打开数据库、构造共享服务并接入 QQ。
- 迁移显式执行，不放入自动重启的普通启动流程。
- start 成功后使用 app.get(Service)；close 后不可重启同一应用。
- 环境文件、凭证与运行脚本属于用户的应用。

## 生命周期与 Webhook

- onModuleInit：初始化服务，此时 QQ 账号尚未启动。
- onApplicationReady：可用账号就绪，启动外部 WS 或定时器。
- onApplicationStopping：先停止业务事件来源。
- onModuleDestroy：排空后释放资源；useValue 资源由调用者管理。
- Webhook 账号声明 `transport: { type: 'webhook' }`；应用声明 `webhook: { host: '127.0.0.1', port: 3000 }`。
- 默认路径 /qq/<AppID>，自有 HTTP 服务用 webhook.listen=false 和 app.webhookHandler()；保留未读取的原始正文和 URL。
