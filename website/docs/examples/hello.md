# 最小 hello

发送 `/hello 小明`，让机器人回复 `你好，小明！`。你将用一个服务生成问候语，用一个控制器接收命令，再用模块把两者注册到应用中。

## 准备项目

先按 [快速开始](../guide/quick-start.md) 创建自己的 TypeScript 项目，安装依赖并配置 tsconfig.json。下面的文件都放在这个项目的 `src/` 目录中。

## 添加业务代码

### src/greeting.service.ts

这个服务接收问候语配置，并生成回复内容。

<<< @/../examples/hello/greeting.service.ts

### src/hello.controller.ts

控制器把 `/hello` 和 `/hi` 交给同一个方法，名字由 `@Arg(0)` 注入。

<<< @/../examples/hello/hello.controller.ts

### src/app.module.ts

注册服务、配置和控制器，并导入 HelpModule 提供命令帮助。

<<< @/../examples/hello/app.module.ts

## 运行这个示例

创建 `src/main.ts`：

<<< @/../examples/hello/main.ts

在项目根目录的 `.env` 中填写 QQ_APP_ID 和 QQ_APP_SECRET，然后执行：

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

## 试一试

| 发送内容      | 预期回复               |
| ------------- | ---------------------- |
| `/hello 小明` | `你好，小明！`         |
| `/hello`      | `你好，朋友！`         |
| `/hi 小明`    | 与 `/hello 小明` 相同  |
| `/help hello` | hello 命令的说明与用法 |

群聊中先 @机器人再发送命令；按 Ctrl+C 关闭程序。没有回复时查看 [排错指南](../guide/troubleshooting.md)。

接下来可以修改 GreetingService 的回复，或添加新的命令方法。暂时没有 QQ 凭证时，按 [离线测试](../guide/testing.md) 在本地运行同一个 AppModule。
