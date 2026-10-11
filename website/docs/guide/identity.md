# 读取用户、群和角色

在命令、按钮或附件处理器中直接声明需要的信息：

```ts
@Command('我是谁')
who(@UserId() userId: string, @GroupId() groupId: string | undefined): string {
  return `用户：${userId}；群：${groupId ?? '私聊'}。`;
}
```

从 `dou-bot` 导入装饰器，将方法放入已注册的控制器。

## 可用装饰器

| 装饰器       | 注入类型                 | 信息                                   |
| ------------ | ------------------------ | -------------------------------------- |
| `@User()`    | `UserInfo`               | id，以及可选 username、bot、memberRole |
| `@UserId()`  | `string`                 | 当前用户 OpenID，与 ctx.userId 一致    |
| `@Group()`   | `GroupInfo \| undefined` | 当前群的 id；私聊为 undefined          |
| `@GroupId()` | `string \| undefined`    | 当前群 OpenID；私聊为 undefined        |
| `@Role()`    | `GroupRole \| undefined` | 群消息作者的 member、admin、owner      |

## 使用规则

- 五个装饰器均无配置项，从 **0.7.0** 开始提供。
- 只读取当前事件，不查询额外资料，不消费文字或附件参数。
- UserInfo、GroupInfo 是冻结快照；用户名为空、bot 为 false 时原样保留。
- 未知或缺失的角色为 `undefined`；私聊和按钮不提供角色。
- 按钮以本次操作者为准，只提供用户 ID 及适用的群 ID，不沿用历史消息资料。
- OpenID 不是 QQ 号或群号；同一人的群聊和私聊 OpenID 不能直接混用。
- `@Role()` 只读信息；限制权限用 [GroupOnly、GroupRoles 等 Guard](./access.md)。

[运行身份与按钮示例](../examples/identity.md)。
