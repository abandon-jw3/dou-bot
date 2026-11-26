# 上下文数据准备

- 用 set 注册已准备的数据，用 provide 注册按需加载器。
- 通过 ContextValue 注入参数，通过 ctx.state.get 在方法中读取。
- 中间件仅演示本地数据；正式启动仍需框架的 PostgreSQL，离线测试不连接数据库。

## 添加到你的项目

按 [快速开始](../guide/quick-start.md) 准备项目，将以下内容保存为 `src/app.module.ts`，保留 `src/main.ts`。

<<< @/../examples/context/app.module.ts

## 运行与试用

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

| 发送位置 | 输入      | 回复                     |
| -------- | --------- | ------------------------ |
| 私聊     | `/上下文` | 命令：上下文；会话：私聊 |
| 群聊     | `/上下文` | 命令：上下文；会话：群聊 |

- 每次执行拥有独立数据，不保存到共享 Service 字段。
- 实际加载服务接收 loader 的 signal；异步 prepare 需等待准备完成。
- 完整规则见 [上下文中间件](../guide/context.md)。
