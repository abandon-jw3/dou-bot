# 内置访问限制与管理者按钮

适用于 dou-bot **0.7.0 / 契约 1.11**。新增五个装饰器，不增加运行时依赖，不需要注册额外 Provider。它们与 `@UseGuards()` 进入同一 Guard 链，先于命令参数绑定和冷却。

## API

| API                            | 允许范围                                                |
| ------------------------------ | ------------------------------------------------------- |
| `GroupOnly(options?)`          | 群聊                                                    |
| `PrivateOnly(options?)`        | 私聊                                                    |
| `UsersOnly(userIds, options?)` | 当前事件的 OpenID 在名单内                              |
| `GroupRoles(...roles)`         | 当前群消息发送者符合任意一个指定角色                    |
| `GroupManagersOnly(options?)`  | 当前群主或管理员，相当于 `GroupRoles('owner', 'admin')` |

`AccessOptions` 包含 `message?: string | false`：省略使用默认拒绝提示，字符串自定义提示，false 静默拒绝。空提示或未知配置字段会报 CONFIG。`GroupRoles` 使用角色列表和默认提示；需要自定义管理者提示可使用 `GroupManagersOnly`。

`UsersOnlyOptions` 另支持 `scene?: 'group' | 'private'` 与 `groupId?: string`。groupId 隐含群聊限制，不能与 private 同时配置。数组至少包含一个非空字符串；配置和名单会复制冻结，之后修改原对象不会改变权限。动态权限使用可注入的自定义 Guard。

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

填入的 ID 是当前机器人从 QQ 收到的 OpenID，不是日常 QQ 号。未指定 scene/groupId 时，对所有会话做精确字符串匹配；它不转换、合并或推断群聊和私聊身份。需要限定场景时显式配置 scene/groupId 或叠加 GroupOnly/PrivateOnly。多机器人各自配置对应的 OpenID。

从 0.6.0 开始，这些装饰器也可以写在模块类上，规则只传递给本模块直接注册的控制器。具体顺序和边界见 [模块 Guard 指南](./module-guards.md)。

## 作用范围与执行规则

- GroupOnly、PrivateOnly、UsersOnly 可作用于控制器类及 Command/OnButton/OnAttachment 方法。
- GroupRoles、GroupManagersOnly 用于命令、附件处理器或对应控制器。直接作用于 OnButton，或由类/继承施加到 OnButton 时，启动报 CONFIG，提示使用按钮原生 permission。不要在同一个带类级角色限制的控制器里放按钮回调。
- 原始 On 观察器保持原有语义：类级规则不约束观察器；在 On 方法上直接放这些装饰器会报 CONFIG。观察器不能用来拦截命令。
- 类级规则先于方法级；基类先于派生类；同一位置按代码从上到下执行，与 UseGuards 混用也保持此顺序。任一规则拒绝即停止。
- 不同装饰器之间是 AND；一个 UsersOnly 名单或一个 GroupRoles 列表内部是 OR。方法声明不能放宽类级限制。覆写方法使用新的方法声明，未重新声明路由的覆写方法不注册。
- 同一有效处理器要求群聊和私聊，或多个 GroupRoles 的交集为空，在启动时拒绝。UsersOnly 声明的 scene/groupId 同样参与场景冲突检查。
- 拒绝不会执行参数解析、业务方法或占用冷却；按钮 manual 模式下，拦截仍会按原有机制确认收到。

## 群角色的数据来源

`GroupRole = 'member' | 'admin' | 'owner'`。GROUP_MESSAGE_CREATE 与 GROUP_AT_MESSAGE_CREATE 的当前发送者 `author.member_role` 归一化为 `GroupMessageContext.memberRole`，并提供给群消息对应的 GuardContext。

只接收这三个精确的小写值。缺失、未知或不合法值保持 undefined，受角色限制的命令拒绝执行；普通命令仍可使用。私聊不读取此字段，不从 mentions、引用消息、转发消息、昵称、OpenID 或上一条消息推测身份。只读取当前事件的角色快照，不保留角色缓存。

依据：[QQ 全量群消息文档](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)。本地测试验证解析和控制流；2026-10-06 的测试群已实际投递 owner、admin、member，且 SDK 归一化一致。实测范围见本文末节。

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

| SDK 权限                            | QQ action.permission                   |
| ----------------------------------- | -------------------------------------- |
| `{ type: 'everyone' }`              | `{ type: 2 }`                          |
| `{ type: 'users', userIds: [...] }` | `{ type: 0, specify_user_ids: [...] }` |
| `{ type: 'managers' }`              | `{ type: 1 }`                          |

三种按钮构建器 callback、command、link 均可配置。managers 只支持群聊目标；QQClient 和具名 QQApi.sendPrivateMessage 在请求 QQ 前抛出 HANDLER_CONTRACT。通用 QQApi.request 保持底层 HTTP 能力，调用方自行负责原始协议。

点击资格交由 QQ 的原生按钮权限处理，不依赖回调中存在 member_role，不自动将命令装饰器转换成按钮配置。命令按钮也可能被用户手动输入相同命令，所以受限命令仍需声明自己的 Guard。

按钮没有单独的 owner 权限枚举；指定身份组 type=3 仅用于频道，不属于本框架范围。ACK 只表示收到交互，业务发送仍用 ctx.send，不能把 interactionId 当作普通消息 ID。

依据：[QQ 消息按钮文档](https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/trans/msg-btn.html)。本地测试验证 permission 编码和发送目标限制；2026-10-06 已补充管理者回调按钮的分角色实测，范围见下文。

## 实机验收范围

2026-10-06，使用 npm 的 dou-bot 0.6.0，在同一测试机器人和群中分别确认三种真实身份：

| 身份     | 仅群主命令 | 管理者命令 | 普通回调按钮 | 管理者回调按钮                         |
| -------- | ---------- | ---------- | ------------ | -------------------------------------- |
| 群主     | 放行       | 放行       | 成功         | 成功                                   |
| 管理员   | 拒绝       | 放行       | 成功         | 成功                                   |
| 普通成员 | 拒绝       | 拒绝       | 成功         | 客户端提示无权限或拒绝，后台无对应回调 |

QQ 群消息的 author.member_role 与 SDK 归一化结果分别为 owner、admin、member。允许的按钮点击均有回调、ACK 和反馈发送记录；普通成员的限制同时有用户客户端确认与后台未执行处理器的证据。该轮无错误记录，完成后已关闭测试连接。详细脱敏证据见 [验收记录](https://github.com/abandon-jw3/dou-bot/blob/main/docs/validation-report.md#2026-10-06-分角色权限与管理者按钮实测)。

这些结果限于本次账号、测试群及 callback 按钮，不保证所有机器人有相同事件字段与平台权限，也不覆盖 command/link 按钮权限、测试过程中的角色变更或公网 Webhook。

## 自动附件处理器

dou-bot 0.7.0 的 `@OnAttachment()` 支持现有 Guard、冷却、身份参数与 `ctx.prompt()`；数量校验在 Guard 之后、冷却之前。多个命中处理器独立、顺序执行，每个处理器结束时清理自己的 Context 和未等待的追问。GroupRoles / GroupManagersOnly 可用于附件处理器，按钮仍使用原生 permission。自定义 Guard 需处理新增的 `kind: 'attachment'` 与 `matchedAttachments`；详情见 [自动处理上传附件](command-parameters.md#自动处理上传附件)。
