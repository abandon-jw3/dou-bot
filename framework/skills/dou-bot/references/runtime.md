# 权限、回复与按钮

## 限制谁能使用

| 业务要求                   | 声明                                           |
| -------------------------- | ---------------------------------------------- |
| 只在群聊使用               | `@GroupOnly()`                                 |
| 只在私聊使用               | `@PrivateOnly()`                               |
| 固定用户名单               | `@UsersOnly(['openid'], { scene: 'private' })` |
| 仅群主                     | `@GroupRoles('owner')`                         |
| 群主或管理员               | `@GroupManagersOnly()`                         |
| 数据库权限、订阅等动态规则 | 注册 Guard，再用 `@UseGuards(GuardClass)`      |

- 场景与名单规则可用于命令、按钮、附件处理器。
- 群角色规则只用于命令或附件处理器；角色缺失时拒绝。按钮没有足够的角色信息，不能直接使用这两个角色装饰器。
- UsersOnly 使用事件 OpenID，可限定 scene/groupId。多个账号有不同名单时，用自定义 Guard 同时检查 `ctx.appId`。
- 方法规则保护单个入口，控制器规则保护该类入口；模块规则只覆盖自己的 controllers，不传播到导入模块。
- 规则逐层累加，不因方法声明而覆盖类规则；重复声明也会重复执行。不要在原始 On 中代替入口授权。

## 自定义权限

- Guard 注册为 Provider，可注入权限服务；UseGuards 接收令牌，不接收手动创建的实例。
- `canActivate(ctx)` 支持同步或异步返回 true、false、`{ allow: false, message: '没有权限' }`。
- false 静默拒绝，带 message 可提示；抛错属于故障，不直接回显内部异常。
- `GuardContext` 提供 appId、userId、scene、target、signal；按 kind 区分 command、button、attachment。
- Guard 不能读取已绑定的命令参数；共享查询结果使用 [上下文中间件](context.md)。
- 示例见 [命令与权限模块](../assets/minimal-module.ts)。

## 限制重复调用

```ts
@Cooldown({ scope: 'user', durationMs: 3000, message: '请稍后再试。' })
```

将它加到命令、按钮或附件方法上，一个方法最多一个。

| scope   | 共享范围                   |
| ------- | -------------------------- |
| user    | 当前会话内的同一用户       |
| session | 当前群或当前私聊           |
| command | 该处理器的全部调用者和会话 |

- 按账号隔离；命令别名共享冷却，不同处理器各自计时。
- message 省略时提示剩余时间，false 静默拒绝。
- Guard 或参数校验失败不占冷却；进入处理器后失败不自动退还。
- 冷却从进入处理器起算，不保证前次任务已结束；禁止任务重叠需业务互斥。
- 冷却重启后清空，不适合跨进程计费；大量记录时按需配置 `execution.cooldownMaxEntries`，默认 10,000。

## 发送回复和图片

- 命令、附件处理器返回字符串或 MessageInput，自动引用当前消息回复。
- 多步回复使用 `await ctx.reply(...)` 并返回 void；`ctx.send(...)` 为普通发送，受 QQ 权限和频控限制。
- 常用构建器：text、image、markdown、keyboard、button，均从 `dou-bot` 导入。
- 图片可用 HTTP(S) URL、有效二进制或 UploadedImage。业务渲染服务返回图片后，用 `image(...)` 构造消息。
- UploadedImage 受机器人和目标限制，不能直接跨账号或跨群复用。

## 添加确认按钮

```ts
import { Command, Controller, Ctx, OnButton, button, keyboard, markdown } from 'dou-bot';
import type { ButtonContext } from 'dou-bot';

@Controller()
export class ConfirmationController {
  @Command('确认')
  ask() {
    return markdown('是否确认？', {
      keyboard: keyboard([button.callback('confirm', '确认', 'continue')]),
    });
  }

  @OnButton('confirm')
  async confirm(@Ctx() ctx: ButtonContext): Promise<void> {
    if (ctx.data !== 'continue') return;
    await ctx.send('已确认。');
  }
}
```

- 注册到模块的 controllers。真实订单或管理操作还需检查操作者、当前业务状态和授权。
- callback 按钮匹配 OnButton 的 ID；`ctx.data` 是业务字符串，不自动解析 JSON，也不是权限凭证。
- link 打开链接；command 发送包含应用前缀的命令，不进入 OnButton。
- 群管理者按钮用 `permission: { type: 'managers' }`，仅发到群聊；不据此推断操作者的 Role。
- 默认自动确认只表示“收到点击”。manual 模式进入处理器后调用 `await ctx.ack()`；Guard/冷却拒绝时框架会补偿确认。
- ButtonContext 有 send、ack，没有 reply、prompt；需要追问时用 command 按钮引导进入命令。
- interactionId 用于确认点击，不能当作普通消息的 msg_id。

### 一维按钮数组自动分行

`keyboard(btns, perRow?)` 按传入顺序排列按钮。假设一维数组 `btns` 有 9 个按钮。

| 调用                     | 从上到下每行的按钮数 |
| ------------------------ | -------------------- |
| `keyboard(btns, 4)`      | 4、4、1              |
| `keyboard(btns, [2, 3])` | 2、3、3、1           |
| `keyboard(btns)`         | 每行 1 个，共 9 行   |

每个行宽都是 1～5 的整数。传入行宽数组时，最后一个宽度用于所有剩余行。

## 事件观察与错误

- `@On('事件名')` 适合观察 QQ 原始事件，参数使用 `@Ctx() ctx: QQEventContext`，返回 void。
- 原始 On 不执行入口 Guard、中间件或冷却，也没有消息 reply；自动处理文件用 OnAttachment。
- 外部请求传入 `ctx.signal` 并等待完成；执行结束后不再使用旧 Context。
- 已知业务失败回复简短说明；未知异常交给 onError 或日志，不将凭证、完整响应或堆栈发到聊天中。
