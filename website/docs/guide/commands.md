# 命令与帮助

用 `@Command()` 注册命令，返回字符串即可回复。

<<< @/../examples/hello/hello.controller.ts

## 名称、别名与前缀

- `@Command('hello', { aliases: ['hi'] })` 注册 `hello` 和别名 `hi`。
- 装饰器中的名称不带前缀；主名称和别名共享冷却。
- 群聊和私聊使用同一前缀，可为空，但不能包含空白。

| 应用配置                    | 用户输入      |
| --------------------------- | ------------- |
| 默认                        | `/hello 小明` |
| `commands: { prefix: '!' }` | `!hello 小明` |
| `commands: { prefix: '' }`  | `hello 小明`  |

- 空前缀仍按开头的完整命令名匹配；`helloThere` 不匹配 `hello`。
- 群聊不 @ 是否可用取决于 QQ 是否投递消息。

## 自动回复与手动回复

- 返回字符串或 `MessageInput`：自动回复当前消息。
- `await ctx.reply()`：手动回复，随后返回 `void`，避免重复发送。
- 使用参数装饰器声明输入来源，见 [参数指南](./parameters.md)。

## HelpModule

将 `HelpModule` 加入模块的 `imports`：

<<< @/../examples/hello/app.module.ts

| 命令               | 作用                           |
| ------------------ | ------------------------------ |
| `/help` 或 `/帮助` | 列出命令                       |
| `/help hello`      | 显示说明与用法，命令名不带前缀 |

帮助列表不会隐藏受限命令，实际调用仍检查 Guard。

## 输入错误

- `commands.invalidInput: 'report'`（默认）：记录错误。
- `commands.invalidInput: 'reply'`：同时回复缺参、类型错误等输入提示。
- 业务异常只上报，不把内部堆栈回复给用户。
