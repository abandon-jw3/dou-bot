# 快速开始

本教程从空目录创建一个能响应 `/hello 小明` 的机器人。完整代码也在 [最小 hello 示例](../examples/hello.md) 中。

## 1. 安装环境与依赖

准备 Node.js **24.21.0** 与 npm **11.19.0**，然后在你自己的项目目录安装依赖。本教程使用 TypeScript **5.9.3**，后面的配置和命令可以直接复制。

```sh
mkdir my-qq-bot
cd my-qq-bot
npm init -y
npm pkg set type=module
npm install --save-exact dou-bot@0.7.0
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

安装的包名为 `dou-bot`。

## 2. 配置编译

新建 `tsconfig.json`：

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

保留 `experimentalDecorators` 和 `emitDecoratorMetadata`：前者启用参数装饰器，后者让框架识别需要注入的服务。下面使用 tsc 编译，再用 Node 运行生成的 JavaScript。

## 3. 编写服务、控制器与模块

创建 `src/greeting.service.ts`：

<<< @/../examples/hello/greeting.service.ts

创建 `src/hello.controller.ts`：

<<< @/../examples/hello/hello.controller.ts

创建 `src/app.module.ts`：

<<< @/../examples/hello/app.module.ts

服务负责生成内容，控制器注册命令，模块把它们连接起来。构造函数中的 `GreetingService` 使用值导入，配置接口通过 `@Inject()` 的 Symbol 令牌注入。

## 4. 添加启动入口

创建 `src/main.ts`：

<<< @/../examples/hello/main.ts

在项目根目录创建 `.env`，填入你自己的凭证：

```dotenv
QQ_APP_ID=YOUR_APP_ID
QQ_APP_SECRET=YOUR_APP_SECRET
```

将 `.env`、`node_modules/` 和 `dist/` 加入 `.gitignore`。不要把 Secret 写在业务源码中。

## 5. 编译和运行

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

私聊机器人发送 `/hello 小明`，预期收到 `你好，小明！`；省略名字则收到 `你好，朋友！`。也可以发送 `/hi 小明` 或 `/help hello`。

群聊中可以 @机器人后发送命令；不 @ 是否能触发取决于 QQ 是否投递该条消息。按 `Ctrl+C` 关闭应用。修改代码后重新编译并启动。

## 下一步

阅读 [项目结构](./project.md)、[模块与依赖注入](./modules.md) 和 [命令参数](./parameters.md)。如果没有收到回复，按 [排错指南](./troubleshooting.md) 区分连接、事件投递、前缀和发送权限问题。
