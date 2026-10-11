# 三级 Guard

- 模块级：仅群聊。
- 类级：检查用户允许名单。
- 方法级：修改设置需群主身份；频繁调用受冷却限制。

## 添加到你的项目

1. 按 [快速开始](../guide/quick-start.md) 准备项目和 `.env`。
2. 在 `src/` 添加以下文件，替换 AppModule，保留 `src/main.ts`。

### src/guards.ts

<<< @/../examples/guards/guards.ts

### src/app.module.ts

<<< @/../examples/guards/app.module.ts

- 启动前，把 `USER_OPENID` 替换为允许操作的群成员 OpenID。
- 可以从该成员发送命令时的 `ctx.userId` 取得这个值；它不是日常 QQ 号，也不应与私聊 OpenID 混用。

## 运行这个示例

在自己的项目根目录执行：

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

## 检查权限是否符合预期

| 操作                                                | 预期结果                             |
| --------------------------------------------------- | ------------------------------------ |
| 在私聊发送 `/info`                                  | 提示只能在群聊使用                   |
| 在群聊发送 `/info`                                  | 回复已通过模块级群聊检查             |
| 用名单外成员发送 `/settings`                        | 提示不在允许名单中                   |
| 用名单内成员发送 `/settings`                        | 回复已通过模块和类级检查             |
| 用名单内群主发送 `/change`                          | 回复已通过三级检查                   |
| 用名单内成员连续发送 `/limited` 和 `/limited-alias` | 第二次提示稍后再试，3 秒后可再次调用 |

- 这些命令只回复检查结果。
- QQ 未提供角色字段时，群主检查会拒绝；排查方法见 [访问限制](../guide/access.md)。
- 群聊中先 @机器人，按 Ctrl+C 结束运行。
- 接入实际管理操作时，把业务调用放在通过 Guard 的命令方法中。
- 更多组合方式见 [Guard 与冷却](../guide/guards.md)，也可以用 [离线测试](../guide/testing.md) 检查允许和拒绝两条路径。
