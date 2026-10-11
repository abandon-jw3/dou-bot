# 快速开始

目标：发送 `/hello 小明`，收到 `你好，小明！`。完整代码见 [hello 示例](../examples/hello.md)。

## 1. 安装环境与依赖

- Node.js **24.21.0**、npm **11.19.0**。
- TypeScript **5.9.3**，使用 ESM。
- 在自己的项目目录执行：

```sh
mkdir my-qq-bot
cd my-qq-bot
npm init -y
npm pkg set type=module
npm install --save-exact dou-bot@0.8.0
npm install --save-dev --save-exact typescript@5.9.3 @types/node@24.19.0
```

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

- `experimentalDecorators`：启用参数装饰器。
- `emitDecoratorMetadata`：支持构造函数注入。
- 先用 `tsc` 编译，再运行生成的 JavaScript。

## 3. 编写服务、控制器与模块

创建 `src/greeting.service.ts`：

<<< @/../examples/hello/greeting.service.ts

创建 `src/hello.controller.ts`：

<<< @/../examples/hello/hello.controller.ts

创建 `src/app.module.ts`：

<<< @/../examples/hello/app.module.ts

- Service：处理业务。
- Controller：接收命令。
- Module：注册服务和控制器。
- 注入类使用值导入；接口配置使用 `@Inject(token)`。

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

| 发送          | 回复                  |
| ------------- | --------------------- |
| `/hello 小明` | `你好，小明！`        |
| `/hello`      | `你好，朋友！`        |
| `/hi 小明`    | 与 `/hello 小明` 相同 |
| `/help hello` | 命令用法              |

- 群聊先 @机器人；不 @ 是否可用取决于 QQ 的消息投递权限。
- 按 `Ctrl+C` 关闭；修改后重新编译并启动。

## 下一步

- 整理业务：[项目结构](./project.md)、[模块与依赖注入](./modules.md)。
- 增加输入：[命令参数](./parameters.md)。
- 没有回复：[排错指南](./troubleshooting.md)。
