# Guard 与冷却

- Guard：检查当前用户是否可以执行操作，支持异步查询。
- Cooldown：限制同一处理器的调用频率。
- 固定场景、用户或角色限制，直接用 [内置访问限制](./access.md)。

## Guard 的使用

注册一个实现 `canActivate()` 的 Provider，再用 `@UseGuards()` 挂载：

```ts
import { Command, Controller, Injectable, Module, UseGuards } from 'dou-bot';
import type { CanActivate, GuardContext, GuardResult } from 'dou-bot';

@Injectable()
class GroupOnlyGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.scene === 'group' ? true : { allow: false, message: '请在群聊中使用此指令。' };
  }
}

@Controller()
class Commands {
  @Command('ping')
  @UseGuards(GroupOnlyGuard)
  ping(): string {
    return 'pong';
  }
}

@Module({ providers: [GroupOnlyGuard], controllers: [Commands] })
class AppModule {}
```

| 返回值                              | 行为       |
| ----------------------------------- | ---------- |
| true                                | 放行       |
| false                               | 静默拒绝   |
| `{ allow: false, message: '提示' }` | 拒绝并提示 |

- 支持同步返回或 Promise；不要返回 `{ allow: true }`。
- 拒绝不调用处理器、不占冷却，也不触发 onError。
- 抛错或返回非法值会停止执行并上报，不向用户回显异常。
- Guard 默认单例，当前用户数据放在方法局部变量中。

## 读取请求信息

- 公共字段：`scene`、`userId`、`target`、`route`、`signal` 等。
- `kind === 'command'`：可读正文、消息 ID 和附件。
- `kind === 'attachment'`：另有本处理器的 `matchedAttachments`。
- `kind === 'button'`：可读按钮 ID、interactionId 和 data。
- Guard 先于参数绑定，没有解析后的 Slot 等参数。
- 没有 reply/send/ack/client；异步外部请求应使用 `ctx.signal`。

完整字段见 [GuardContext](../api/contexts.md#guardcontext)。

## 模块统一配置

以下类由业务定义，Guard 需在本模块注册或经 imports/exports 引入：

```ts
@Module({
  controllers: [QueryController, SettingsController],
  providers: [FeatureGuard, ControllerGuard, MethodGuard],
  guards: [FeatureGuard],
})
export class FeatureModule {}
```

- FeatureGuard 保护两个控制器的 Command、OnButton 和 OnAttachment。
- 只保护本模块直接注册的控制器，不传播到导入模块。
- `guards` 放 Provider 令牌，不放 Guard 实例或 `GroupOnly()` 等装饰器。
- 模块类也可用 `@UseGuards(FeatureGuard)` 或 `@GroupOnly()` 声明规则。

## 类级和方法级

```ts
@Controller()
@UseGuards(ControllerGuard)
export class SettingsController {
  @Command('修改设置')
  @UseGuards(MethodGuard)
  change(): string {
    return '已通过模块、类和方法级检查。';
  }
}
```

执行顺序：**模块 guards → 模块类 → 控制器类 → 方法**。

- 列表从左到右，叠加装饰器从上到下；类继承时基类在先。
- 规则累加，方法不能放宽模块或类限制；重复声明会重复执行。
- 覆写方法需重新声明路由，方法级规则使用新声明。
- 原始 On 不受这条链保护，也不能直接声明 Guard 或 Cooldown。
- 帮助列表不按 Guard 隐藏命令；HelpModule 有独立的模块范围。

## 命令冷却

在命令、按钮或附件处理方法上添加，每个方法最多一个：

```ts
@Cooldown({ scope: 'user', durationMs: 3000, message: '请稍后再试。' })
```

| scope   | 同一处理器内共享冷却的范围       |
| ------- | -------------------------------- |
| user    | 同一会话中的同一用户，不同群独立 |
| session | 同一群或同一私聊                 |
| command | 所有用户和会话                   |

- `durationMs` 为 1～2147483647 的整数。
- `message` 省略时提示剩余时间，字符串自定义提示，`false` 静默拒绝。
- 命令别名共享冷却；不同处理器各自计时。
- Guard 和参数校验通过后才占用；业务或发送失败不退还。
- 重复触发不延长冷却；冷却到期后可再次调用，即使前一次尚未结束。
- 冷却保存在进程内，重启重置；记录上限由 `execution.cooldownMaxEntries` 设置，默认 10000。

## 按钮与异步操作

- 自动 ACK 只确认收到点击，不表示权限通过或业务成功。
- 手动确认模式下，Guard/冷却拒绝或检查出错由框架补偿确认；进入处理器后由业务 `await ctx.ack()`。
- 按钮提示通过普通发送，仍受 QQ 权限限制。
- 群角色规则支持命令和附件处理器；按钮点击资格用原生 `permission`。
- prompt 后续回答不重跑 Guard、不重新扣冷却。
- 外部异步任务应配合取消信号，关闭后迟到的放行不会继续业务。

[运行三级 Guard 示例](../examples/guards.md)。
