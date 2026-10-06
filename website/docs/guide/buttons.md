# Markdown 与按钮

用 Markdown 展示内容，再加上链接、命令或回调按钮，让用户直接选择下一步操作。下面的 `/menu` 会发送一个可点击的菜单，不需要模板 ID。

<<< @/../examples/buttons/app.module.ts

## 三种按钮

| 构建函数                                    | 行为                             |
| ------------------------------------------- | -------------------------------- |
| button.link(label, url, options?)           | 打开 HTTP(S) 链接                |
| button.command(label, command, options?)    | 输入或发送命令；enter 默认 false |
| button.callback(id, label, data?, options?) | 产生由 OnButton 按 id 路由的回调 |

keyboard 接受二维按钮数组，每个内层数组是一行。行不能为空，每行最多 5 个按钮；平台的额外限制仍以实际接口结果为准。

默认点击后文案与原 label 相同，可用 visitedLabel 修改。style 为 secondary 或 primary；默认 secondary。callback 的 ID 是第一个参数，不能再在 options 中提供另一个 ID。

## 回调确认与业务结果

默认 `interactions.acknowledge: 'auto'` 自动确认收到交互；手动模式的处理器应 `await ctx.ack()`。Guard 或冷却在手动模式下阻止业务时，框架会做兜底确认。

确认收到不是授权通过，也不是业务操作成功。按钮处理器返回 void，业务回复用 ctx.send；ButtonContext 没有 reply 和 prompt，interactionId 不能作为消息引用。

## 限制点击者

ButtonOptions.permission 支持 everyone、users 和 managers。管理者按钮只可发往群聊；详见 [群角色与管理者按钮](./access.md#管理者按钮)。

回调数据应按不可信输入校验。真正修改数据的操作还需验证业务身份与操作对象。命令按钮对应的文字也可以由用户手动输入，因此命令自己的 Guard 仍然需要保留。

添加权限后，按 [权限检查表](./access.md#实机验收范围) 用不同身份检查按钮是否符合预期。完整代码和操作步骤见 [按钮示例](../examples/buttons.md)。
