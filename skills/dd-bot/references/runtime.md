# Guard、冷却、消息与按钮

## Guard 与执行顺序

0.4.0 提供无需注册 Provider 的 GroupOnly、PrivateOnly、UsersOnly、GroupRoles、GroupManagersOnly，均可从 dd-bot 导入。它们与 UseGuards 混合时保持类/方法、继承与代码声明顺序；GroupOnly/PrivateOnly 冲突及空角色交集在启动时报 CONFIG。

- `@UsersOnly(['openid'], { scene: 'private', message: false })` 精确匹配名单，可指定 scene 或 groupId（隐含 group）。未指定范围时匹配所有会话，不转换跨场景 OpenID；动态名单仍用业务 Guard。
- `@GroupRoles('owner')` 仅群主；`@GroupManagersOnly()` 为 owner 或 admin；只读取当前群消息 author.member_role，缺失/未知时拒绝。GroupMessageContext/群消息 GuardContext 暴露可选 memberRole，私聊不携带。
- 群角色规则仅用于命令；类级或方法级角色规则作用到 OnButton 会报 CONFIG。按钮点击使用 `permission: { type: 'managers' }`，映射 QQ permission.type=1，只能发到群聊。QQClient 和具名私聊 API 在请求前拒绝该权限。
- GroupOnly、PrivateOnly、UsersOnly 可保护 Command/OnButton。类级规则不限制 On 观察器；不能把规则直接写在 On 方法上。
- 不从回调、引用作者、mentions 或昵称猜测群角色，不用发送按钮的那个人代替点击者。原生按钮权限不等于可复用的业务授权；命令按钮对应的命令若有权限要求仍声明自己的规则。

命令/按钮按 Guard → 命令参数绑定（仅命令）→ 冷却占用 → 业务方法执行。原始 On 观察器仍先独立执行，不能靠它拒绝后续命令。

```ts
import { Injectable } from 'dd-bot';
import type { CanActivate, GuardContext, GuardResult } from 'dd-bot';

@Injectable()
export class GroupOnlyGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.scene === 'group' ? true : { allow: false, message: '请在群聊中使用此指令。' };
  }
}
```

这是群聊限定策略的示例，并非所有机器人都需要它。将 Guard 注册为 providers，并在 Controller 类或 Command/OnButton 方法上使用 `@UseGuards(GroupOnlyGuard)`。传入 Provider 令牌，不能传入 `new GroupOnlyGuard()` 实例。

canActivate 可异步返回 true、false 或 `{ allow: false, message?: string }`。true 放行；false 静默拒绝；对象形式可提示。不要返回 `{ allow: true }`、undefined 或随意的其他对象。正常拒绝不计入 failed/onError；抛错及不合法结果上报 guard 阶段，不回显内部异常。

类级 Guard 先于方法级，列表按从左到右执行，多个 UseGuards 声明按代码从上到下执行；继承时先基类类级，再派生类类级，最后是有效方法级。任意一项拒绝即停止。Guard 受模块可见性和生命周期约束，默认单例；支持注入业务权限服务。

GuardContext 有 userId、scene、target、signal、raw、controller、method、规范 route 等信息。kind 为 command 时有 content/messageId/attachments，button 时有 interactionId/buttonId/data；group 场景还有 groupId。它没有 reply/send/ack/client，也没有已绑定的参数。

用户身份取平台 OpenID；不要将日常 QQ 号当作 OpenID，也不要假定私聊 user_openid 与群 member_openid 可以跨场景合并。

## 冷却

`@Cooldown({ scope: 'user', durationMs: 3000 })` 用于 Command/OnButton 方法，一个方法最多一个。

| scope   | 同一处理器内的共享范围   |
| ------- | ------------------------ |
| user    | 当前会话内同一个用户     |
| session | 当前群或当前私聊         |
| command | 该处理器所有调用者及会话 |

命令别名共享记录；不同处理器和不同应用独立。查询与刷新按钮不自动共享冷却。message 省略则提示剩余时间，字符串指定提示，false 静默。durationMs 是 1～2147483647 的整数。

Guard 拒绝与参数错误不占名额；业务抛错或发送失败不退还名额。重复拒绝不延长期限。冷却从业务入口开始，不是“上一请求完成后计时”的互斥锁，也不是跨进程限流器。

execution.cooldownMaxEntries 默认 10000。容量满时清理过期项，仍满则报 RESOURCE_LIMIT，不淘汰有效项以放行。重启会重置进程内记录。

## 消息返回与上下文

命令返回字符串或 MessageInput 即自动引用原消息回复。手动 `await ctx.reply(...)` 后返回 void；不要再 return 第二条消息。`ctx.send(...)` 是普通无引用发送，受 QQ 平台权限约束，不能当成总能成功的 reply 替代品。

上下文只在当前处理周期内使用；不要保存 ctx.reply/send/ack 给晚到定时器。框架会跟踪上下文操作，但业务仍应明确 await；注入原始 QQClient/QQApi 的调用不自动成为上下文操作。

常用构建器的参数顺序：

```ts
import { text, image, markdown, keyboard, button } from 'dd-bot';
import type { ImageSource } from 'dd-bot';

export function renderExamples(source: ImageSource) {
  return [
    text('消息'),
    image(source, { caption: '图片说明' }),
    markdown('**请选择**', {
      keyboard: keyboard([
        [
          button.callback('query:refresh', '刷新', 'opaque-business-token'),
          button.link('查看页面', 'https://example.com/'),
          button.command('帮助', '/help', { enter: true }),
        ],
      ]),
    }),
  ];
}
```

command 按钮的文本应符合应用实际前缀；上例采用默认 /。image 可用 HTTP(S) URL、有效二进制或已上传图片。UploadedImage 按机器人、API origin、场景和目标限制复用，不能任意跨目标使用。

本 SDK 使用原始 Markdown 和内联键盘，不提供模板 ID 发送分支。不要发明 markdownTemplate/keyboardTemplate、模板参数或不在公开声明中的便捷方法。按钮默认保留点击前后的标签；visitedLabel 可显式改写，空字符串也有意义。

## 回调和确认

`@OnButton('query:refresh')` 处理 callback 按钮；方法返回 void。链接按钮和 command 按钮不走此回调。`ctx.data` 是字符串，不自动解析 JSON 或证明用户有权限；根据业务校验数据、发起者和目标，需要服务端状态时加有效期与容量限制。

ButtonContext 提供 ack 和 send，没有 reply；统一获取目标可用 ctx.target。群按钮的 groupId 从 ctx.target 的 group 分支取，不假设 ButtonContext 直接暴露 groupId。

默认 auto 会在接纳时确认收到，不代表业务已成功。manual 模式下，进入处理器后由业务调用 `await ctx.ack()`；同一次上下文重复相同 code 会复用，不能再换 code。Guard/冷却阻止处理器时，框架在 manual 模式补做 code=0 的收到确认，且不等待拒绝提示发送。

interactionId 只用于交互确认，不能冒充普通消息 msg_id。按钮回复用 ctx.send，失败保留 QQApiError，不把它改造成假引用或盲目重发。

## 原始事件与异常

`@On` 精确匹配 QQ 事件名，例如 C2C_MESSAGE_CREATE、GROUP_AT_MESSAGE_CREATE、GROUP_MESSAGE_CREATE、INTERACTION_CREATE；不是 Koishi 的通用 message 事件。观察器用 QQEventContext 并返回 void；它没有消息 reply 方法。On 方法不支持命令参数装饰器、Guard 或 Cooldown。

SDK 的输入错误提示只覆盖框架解析阶段。业务已知错误可转换成友好消息，未知异常交给 onError；不要直接把外部响应正文、鉴权信息或异常堆栈回显给聊天。业务网络传递 ctx.signal，发送失败不无条件重试，以免重复产生副作用。
