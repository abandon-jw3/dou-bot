# 命令与帮助

命令名写在 `@Command()` 中，前缀由应用统一配置。

<<< @/../examples/hello/hello.controller.ts

## 名称、别名与前缀

`@Command('hello', { aliases: ['hi'] })` 对应 `/hello` 和 `/hi`。名称不带前缀，别名与主命令共享处理器和冷却状态。

| 配置                        | 输入          |
| --------------------------- | ------------- |
| 默认                        | `/hello 小明` |
| `commands: { prefix: '!' }` | `!hello 小明` |
| `commands: { prefix: '' }`  | `hello 小明`  |

每个应用使用一个前缀，群聊和私聊共用；前缀可以为空但不能包含空白。空前缀按消息开头的完整指令名匹配，`helloThere` 或 `say hello` 不会匹配 hello。

群聊能否不 @ 取决于 QQ 是否投递消息。框架接收普通群消息和 @ 群消息；不根据正文中任意提及猜测谁是机器人。

## 自动回复与手动回复

命令返回字符串或支持的消息对象会自动回复。复杂流程可注入 `@Ctx()` 并 `await ctx.reply()`，之后返回 void。不要既手动 reply 又返回消息，造成重复发送。

命令的参数必须通过参数装饰器明确来源；详细规则见 [参数指南](./parameters.md)。

## HelpModule

在根模块或功能模块中显式导入 HelpModule：

<<< @/../examples/hello/app.module.ts

`/help` 或 `/帮助` 列出命令，`/help hello` 显示对应说明与用法。帮助参数填写不带前缀的命令名。帮助列表不按业务 Guard 隐藏受限命令；实际调用仍经过 Guard。

## 输入错误

`commands.invalidInput` 默认为 `report`，错误进入日志和 onError。设置为 `reply` 后，缺参、类型错误、Slot 歧义等解析错误会额外给用户提示和用法。业务异常不会把内部堆栈直接回复到聊天里。
