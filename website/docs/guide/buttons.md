# Markdown 与按钮

用 Markdown 加上按钮，提供可点击的菜单，无需模板 ID。

<<< @/../examples/buttons/app.module.ts

## 三种按钮

| 构建函数                                    | 行为                             |
| ------------------------------------------- | -------------------------------- |
| button.link(label, url, options?)           | 打开 HTTP(S) 链接                |
| button.command(label, command, options?)    | 填入命令；`enter: true` 直接发送 |
| button.callback(id, label, data?, options?) | 触发对应 `@OnButton(id)`         |

- `style`：secondary（默认）或 primary。
- `visitedLabel`：点击后的文案，默认与 label 相同。
- callback 的 ID 在首参指定，不能在 options 重复填写。

`keyboard` 可以为一维按钮数组自动分行，也可以接收已排好行的二维数组。例如 `btns` 有 9 个按钮时：

```ts
keyboard(btns, 4); // 每行最多 4 个，排成 4、4、1
keyboard(btns, [2, 3]); // 首行 2 个，之后每行最多 3 个，排成 2、3、3、1
keyboard(btns); // 默认每行 1 个
```

每个行宽都是 1～5 的整数。传入多个行宽时按顺序使用，最后一个行宽用于所有剩余行。

## 回调确认与业务结果

- 默认自动 ACK，表示已收到点击。
- 手动模式设置 `interactions.acknowledge: 'manual'`，处理器内 `await ctx.ack()`。
- Guard 或冷却阻止手动模式的处理器时，框架补偿确认。
- 处理器返回 `void`，回复使用 `ctx.send()`；按钮没有 reply/prompt。
- ACK 不表示业务成功，interactionId 也不是可回复的消息 ID。

## 限制点击者

- `permission` 支持 everyone、users、managers，详见 [管理者按钮](./access.md#管理者按钮)。
- managers 只用于群聊；添加后按 [权限检查表](./access.md#实机验收范围) 检查。
- 修改数据前校验 data、操作对象及业务权限。
- 命令按钮对应的文字也能手动输入，命令仍需自己的 Guard。

[运行按钮示例](../examples/buttons.md)。
