# 读取用户、群和角色

在命令、按钮或附件处理器参数中声明需要的信息，框架会同步注入当前事件的身份快照。

| 装饰器  | 类型                   | 提供的信息                                                    |
| ------- | ---------------------- | ------------------------------------------------------------- |
| User    | UserInfo               | id，以及事件实际提供的 username、bot、memberRole              |
| UserId  | string                 | 当前用户 OpenID，与 ctx.userId 一致                           |
| Group   | GroupInfo 或 undefined | 当前群 id；私聊没有群对象                                     |
| GroupId | string 或 undefined    | 当前群 OpenID；私聊为 undefined                               |
| Role    | GroupRole 或 undefined | 群消息发送者的 member、admin、owner；缺失或未知时为 undefined |

这些装饰器从 0.7.0 开始提供，均无配置参数，不发起额外的资料查询。UserInfo 和 GroupInfo 是冻结对象；同一事件可以共享，不同事件独立。用户名为空、bot 为 false 时会原样保留。

```ts
@Command('我是谁')
who(@UserId() userId: string, @GroupId() groupId: string | undefined): string {
  return `用户：${userId}；群：${groupId ?? '私聊'}。`;
}
```

把 Command、UserId、GroupId 从 `dou-bot` 导入，并将方法放进已注册的控制器。它们不占用命令文字或附件，也不会出现在帮助的输入参数中。

按钮以本次操作者为准，只有用户 ID 和适用的群 ID，昵称、机器人标记和角色可能缺失。不会从上一条消息或管理者按钮权限推断角色。群聊和私聊的 OpenID 属于各自场景，不是显示用 QQ 号、群号，也不能直接假定它们代表同一身份。

Role 只提供信息，不执行权限检查。需要限制场景和权限时，使用 [GroupOnly、GroupRoles 等 Guard](./access.md)。若先询问再进行敏感操作，应从新输入复核业务所需权限。

[运行身份与按钮示例](../examples/identity.md)。
