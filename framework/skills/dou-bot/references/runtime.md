# 权限、回复与按钮交互

以下用法面向 dou-bot 0.7.0。先明确谁可以触发操作、拒绝时是否提示，以及处理成功后回复什么。

## 限制谁能使用

| 业务要求                       | 声明                                            |
| ------------------------------ | ----------------------------------------------- |
| 只在群聊使用                   | `@GroupOnly()`                                  |
| 只在私聊使用                   | `@PrivateOnly()`                                |
| 固定用户名单                   | `@UsersOnly(['openid'], { scene: 'private' })`  |
| 仅群主                         | `@GroupRoles('owner')`                          |
| 群主或管理员                   | `@GroupManagersOnly()`                          |
| 数据库权限、订阅状态等动态规则 | 注册自定义 Guard，再用 `@UseGuards(GuardClass)` |

GroupOnly、PrivateOnly、UsersOnly 可用于命令、按钮和附件处理器。GroupRoles、GroupManagersOnly 用于群消息触发的命令或附件处理器；角色缺失或无法识别时拒绝。按钮事件没有足够的群角色信息，不能直接套用这两个角色装饰器。

UsersOnly 使用事件中的 OpenID，可以通过 scene 或 groupId 限定范围；日常 QQ 号不能直接代替 OpenID，也不把群成员 ID 与私聊用户 ID 当作同一标识。

规则放在方法上保护单个入口，放在控制器类上保护该类的业务入口。模块的 guards 或模块类规则只保护本模块 controllers 中的命令、按钮和附件处理器，不自动保护导入模块的控制器。需要统一权限时明确覆盖相关入口；不要把权限检查放在原始 On 观察器里。

自定义 Guard 通过 providers 注册，支持注入权限服务。`canActivate(ctx)` 可以异步返回 true、false 或 `{ allow: false, message: '没有权限' }`。正常拒绝可以静默或提示；抛错属于执行故障，不直接回复内部异常。UseGuards 接收 Provider 令牌，不接收手动构造的实例。

多层规则依次执行：模块配置 → 模块类 → 控制器类 → 方法。列表从左到右，叠加装饰器按代码从上到下；任意规则拒绝就停止当前入口。方法规则与类规则叠加，不会覆盖类上的限制；相同 Guard 重复声明也会重复执行。可运行的自定义权限例子见 [命令与权限模块](../assets/minimal-module.ts)。

GuardContext 提供 userId、scene、target、signal 和路由信息。按 kind 区分 command、button、attachment：附件入口可读取 matchedAttachments，按钮入口可读取 data。Guard 不负责直接发送消息，也拿不到已经绑定的命令参数。

## 限制重复调用

```ts
@Cooldown({ scope: 'user', durationMs: 3000, message: '请稍后再试。' })
```

将它加到 Command、OnButton 或 OnAttachment 方法上，一个方法最多一个。可选范围：

| scope   | 共享范围                   |
| ------- | -------------------------- |
| user    | 当前会话内的同一用户       |
| session | 当前群或当前私聊           |
| command | 该处理器的全部调用者和会话 |

命令别名共享冷却，不同处理器各自计时；查询命令与刷新按钮不会自动共享冷却。message 省略时提示剩余时间，false 表示静默拒绝。

Guard 先执行，再绑定参数并校验附件，随后占用冷却并进入处理器。权限拒绝和参数错误不占冷却；处理器或发送失败后不自动退还。冷却从进入业务时起算，不保证上一次任务已经结束；需要禁止任务重叠时，由业务服务实现互斥。

冷却是单实例内的状态，重启后清空；不能据此实现跨进程的计费或配额。默认最多保存 10,000 条记录，达到限制会报 RESOURCE_LIMIT，按实际用户数及冷却时长配置 `execution.cooldownMaxEntries`。

## 回复消息

命令和附件处理器返回字符串或 MessageInput，会自动引用当前消息回复。需要多步回复时使用 `await ctx.reply(...)`，方法返回 void。`ctx.send(...)` 是普通发送，受 QQ 平台权限与频控约束，不能假定它总能替代引用回复。

常用构建器是 text、image、markdown、keyboard 和 button。图片可用 HTTP(S) URL、有效二进制或已经上传的图片；已上传图片按机器人和目标限制复用，不能直接跨群发送同一 UploadedImage。

```ts
import { Command, Controller, Ctx, OnButton, button, keyboard, markdown } from 'dou-bot';
import type { ButtonContext } from 'dou-bot';

@Controller()
export class ConfirmationController {
  @Command('确认')
  ask() {
    return markdown('是否确认？', {
      keyboard: keyboard([[button.callback('confirm', '确认', 'continue')]]),
    });
  }

  @OnButton('confirm')
  async confirm(@Ctx() ctx: ButtonContext): Promise<void> {
    if (ctx.data !== 'continue') return;
    await ctx.send('已确认。');
  }
}
```

把此控制器注册到应用模块的 controllers。这个示例展示按钮消息与回调；真正执行订单、管理等操作前，还要检查操作者、业务状态和授权。

## 区分按钮的行为

- callback 按钮匹配 OnButton 的 button ID，ctx.data 是业务字符串，不会自动解析 JSON，也不是权限凭证。
- link 按钮打开链接；command 按钮发送命令文本，不进入 OnButton。命令文本应包含应用实际使用的前缀。
- 群管理者按钮使用 `permission: { type: 'managers' }`，只发到群聊；发送入口可用 GroupOnly 限定。不要从这份权限配置推断点击者的 Role。
- 默认自动确认表示“收到点击”，不表示业务成功。manual 模式下，处理器进入后调用 `await ctx.ack()`；被 Guard 或冷却拦截时无需等待业务代码补确认。
- ButtonContext 提供 send 和 ack，没有 reply 或 prompt。需要从按钮开始多轮提问，可以使用 command 按钮引导用户进入命令流程。

群按钮目标可以从 ctx.target 的 group 分支读取，也可用 GroupId 参数装饰器。interactionId 用于确认点击，不能当作普通消息的 msg_id。发送失败按实际 QQ 错误排查，不伪造引用或盲目重发。

## 日志与业务失败

On 用于观察具体 QQ 事件，例如 C2C_MESSAGE_CREATE、GROUP_AT_MESSAGE_CREATE、GROUP_MESSAGE_CREATE。方法接收 QQEventContext 并返回 void；它没有消息 reply 方法，也不使用命令参数、Guard 或 Cooldown。需要自动处理用户文件时优先使用 OnAttachment。

上下文只在当前执行流程中使用。异步请求传入 ctx.signal 并明确 await；应用要长期保存的是业务数据，而不是 ctx 或它的发送方法。已知业务失败回复清楚的说明，未知异常交给 onError 或应用日志，避免把凭证、外部响应正文或堆栈回显到聊天。
