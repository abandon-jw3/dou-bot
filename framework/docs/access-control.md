# 内置访问限制与管理者按钮

用装饰器限制使用场景、用户或群角色，无需注册额外 Provider。

## API

| 装饰器                          | 允许范围                              |
| ------------------------------- | ------------------------------------- |
| `@GroupOnly()`                  | 群聊                                  |
| `@PrivateOnly()`                | 私聊                                  |
| `@UsersOnly(userIds, options?)` | 名单中的当前用户 OpenID               |
| `@GroupRoles(...roles)`         | member、admin、owner 中指定的任一角色 |
| `@GroupManagersOnly()`          | 群主或管理员                          |

- `message` 可省略（默认提示）、设置非空字符串或 `false`（静默拒绝）。
- `GroupRoles` 只接收角色列表；自定义管理者提示用 `GroupManagersOnly`。
- `UsersOnly` 另支持 `scene`、`groupId`；groupId 隐含群聊，不能与 private 共用。
- OpenID 从当前事件取得，不是 QQ 号；动态名单使用 [自定义 Guard](execution-controls.md)。

```ts
import {
  Command,
  Controller,
  GroupManagersOnly,
  GroupRoles,
  PrivateOnly,
  UsersOnly,
} from 'dou-bot';

@Controller()
export class SettingsController {
  @Command('群设置')
  @GroupManagersOnly({ message: '仅群主或管理员可修改群设置。' })
  settings(): string {
    return '可以修改本群设置。';
  }

  @Command('群主操作')
  @GroupRoles('owner')
  owner(): string {
    return '已确认当前群主身份。';
  }

  @Command('内部测试')
  @PrivateOnly()
  @UsersOnly(['replace-with-private-openid'])
  internal(): string {
    return '指定用户检查通过。';
  }
}
```

## 作用范围与执行规则

- 可声明在模块类、控制器类或处理方法上；模块只保护自己直接注册的控制器。
- 场景和用户限制支持 Command、OnButton、OnAttachment。
- 角色限制支持 Command、OnAttachment，不能施加到 OnButton。
- 多个规则必须全部通过；单个名单或角色列表命中一项即可。
- 方法规则不能放宽类或模块规则；群聊/私聊冲突、角色交集为空会报 CONFIG。
- 拒绝时不绑定参数、不调用处理器、不占冷却。
- 原始 On 不受这些规则保护，也不能直接添加限制装饰器。

组合顺序见 [模块 Guard](module-guards.md#模块统一配置)。

## 群角色的数据来源

- 读取当前群消息的 `author.member_role`：`member`、`admin`、`owner`。
- 缺失或未知角色为 `undefined`，受角色限制的操作会拒绝。
- 不从昵称、QQ 号、历史消息或按钮权限推断角色。
- 管理员被拒绝时，检查消息实际角色字段及允许列表。

## 管理者按钮

```ts
import { button, keyboard, markdown } from 'dou-bot';

const card = markdown('**群管理**', {
  keyboard: keyboard([
    [
      button.callback('group:settings', '确认设置', 'confirm', {
        permission: { type: 'managers' },
      }),
    ],
  ]),
});
```

| permission                          | 允许点击者               |
| ----------------------------------- | ------------------------ |
| `{ type: 'everyone' }`              | 所有人（默认）           |
| `{ type: 'users', userIds: [...] }` | 指定 OpenID              |
| `{ type: 'managers' }`              | 群主和管理员，仅支持群聊 |

- callback、command、link 均可设置，点击资格由 QQ 检查。
- 没有单独的“仅群主”按钮权限选项。
- 命令按钮的文字可被手动输入，对应命令仍需自己的 Guard。
- ACK 只确认收到点击；按钮业务回复用 `ctx.send()`。

## 可运行示例

[完整访问限制模块](https://github.com/abandon-jw3/dou-bot/blob/main/website/examples/access/app.module.ts) 展示场景、用户和管理者按钮；使用前替换 USER_OPENID。

## 检查权限配置

在自己的测试群分别使用以下身份：

| 身份     | 仅群主命令 | 管理者命令 | 普通按钮 | 管理者按钮 |
| -------- | ---------- | ---------- | -------- | ---------- |
| 群主     | 允许       | 允许       | 允许     | 允许       |
| 管理员   | 拒绝       | 允许       | 允许     | 允许       |
| 普通成员 | 拒绝       | 拒绝       | 允许     | 由 QQ 拒绝 |

角色缺失会拒绝受限命令；按钮可点击但没有回复时，检查回调 ID、data、业务 Guard 和发送权限。
