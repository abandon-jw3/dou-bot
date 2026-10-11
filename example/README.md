# dou-bot 业务示例

- 使用 **dou-bot 0.7.0**，通过 WS 接收 QQ 官方群聊和私聊消息。
- 可单独复制运行，包含命令、附件、身份、权限、按钮和多轮对话。
- 环境：Node.js **24.21.0**、npm **11.19.0**、TypeScript **5.9.3**。

## 启动

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/example
npm ci
```

复制 `.env.example` 为 `.env`，填写凭证：

```dotenv
QQ_APP_ID=your-qq-app-id
QQ_APP_SECRET=your-qq-app-secret
```

.env 已被 Git 忽略。编译并启动：

```sh
npm run build
npm start
```

| 发送          | 回复         |
| ------------- | ------------ |
| `/hello`      | 你好，朋友！ |
| `/hello 小明` | 你好，小明！ |
| `/example`    | 功能示例列表 |

- 群聊先 @机器人；普通消息是否投递取决于账号权限。
- 按 `Ctrl+C` 关闭连接。

## 保存后自动重启

```sh
npm run dev
```

- 监听源码、.env、编译配置及包清单。
- 编译成功后关闭旧进程、启动新进程；不会同时运行两个机器人。
- 编译失败保留上次成功版本，首次失败则不启动。
- 开发产物位于 work，不覆盖生产 dist；启动异常后修复并再次保存。
- 重启会清空对话、冷却和去重，等“机器人已启动”后再测试。
- 终端环境变量优先于 .env；`Ctrl+C` 关闭整个开发会话。

## 添加自己的命令

修改 [src/bot.controller.ts](src/bot.controller.ts)：

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

- `@Command` 注册名称，`@Arg(0)` 读取第一个参数，返回字符串自动回复。
- 新增控制器后，在 [AppModule](src/app.module.ts) 的 controllers 注册。
- 要直接发送 `hello`，在 [启动配置](src/main.ts) 设置 `commands.prefix: ''`。
- 只保留最小项目时，移除 ExampleModule 的导入和 imports 项。

## 选择功能示例

| 功能                 | 试用入口                                           |
| -------------------- | -------------------------------------------------- |
| 参数、选项、无序匹配 | `/example-arg`、`/example-option`、`/example-slot` |
| 图片与分条附件       | `/example-images`、`/example-upload file`          |
| 直接上传 DOCX        | 发送“报告_20261007.docx”                           |
| 用户、群、角色       | `/example-identity`                                |
| 权限和冷却           | `/example-managers`、`/example-cooldown`           |
| 按钮                 | `/example-button`                                  |
| 多轮输入             | `/example-prompt`                                  |

完整命令和代码位置见 [示例模块说明](src/example/README.md)。

## 目录与编译

| 路径                  | 用途                 |
| --------------------- | -------------------- |
| src/main.ts           | 凭证、启动和关闭     |
| src/app.module.ts     | 注册业务模块         |
| src/bot.controller.ts | 最小命令             |
| src/example/          | 可选功能演示         |
| tests/                | 离线业务测试         |
| scripts/              | 编译、开发重启和检查 |
| vendor/               | SDK 版本与来源记录   |

- 使用 tsc 编译到 dist，再由 Node 运行。
- 相对导入使用 `.ts`，rewriteRelativeImportExtensions 会将产物路径改成 `.js`。
- 保留装饰器和元数据编译选项；包导入仍写 `dou-bot`。

## 本地检查

```sh
npm test        # 离线业务测试，无需 QQ 凭证
npm run check   # 完整检查
npm run format  # 统一格式
```

- 上述命令在本目录运行。
- 仓库根目录可用 `example:check/build/start/dev` 对应入口。
- SDK 从 npm 安装，无需框架源码；升级方式见 [vendor 说明](vendor/README.md)。

采用 [MIT](LICENSE)，上游声明见 [NOTICE](NOTICE)。
