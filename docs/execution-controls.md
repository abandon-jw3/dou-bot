# Guard、冷却与完整业务示例

对应 dou-bot 0.6.0 / 公开契约 1.7。TypeScript 仍固定为 5.9.3，运行时依赖仍为 reflect-metadata 与 ws。

内置场景、用户、群角色限制和管理者按钮权限见 [访问限制指南](./access-control.md)，它们与 UseGuards 共用执行链。

二次输入可使用 [ctx.prompt()](./prompts.md)；后续回答不作为新命令重复执行 Guard 或扣除冷却。

## Guard 的使用

Guard 是注册在 providers 中的可注入服务，通过 `canActivate(ctx)` 返回是否允许执行。模块类、控制器类和方法均可声明 `@UseGuards(...)`；模块也可通过 `@Module({ guards: [...] })` 统一配置。完整作用范围见 [模块 Guard 指南](./module-guards.md)。

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

| API                            | 契约                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| `UseGuards(...tokens)`         | 接收一个或多个 `InjectionToken<CanActivate>`；类、字符串、Symbol 都可以；不接收 Guard 实例 |
| `CanActivate.canActivate(ctx)` | 返回 `GuardResult` 或 `Promise<GuardResult>`，可注入权限服务异步检查                       |
| `GuardResult`                  | true 放行；false 静默拒绝；`{ allow: false, message?: string }` 拒绝并可提示               |
| `GuardContext`                 | 当前请求信息及 signal；无 reply/send/ack/client，发送决策交回框架                          |

GuardContext 共用字段为 appId、eventName、eventId（可选）、receivedAt、raw、signal、userId、scene、target、controller、method、route。route 是规范命令名或按钮 ID，不随命令别名改变。群聊还有 groupId。`kind === 'command'` 时可访问 messageId、content、attachments；`kind === 'button'` 时可访问 interactionId、buttonId、data。没有解析后的参数，因为 Guard 先于参数绑定执行。

GuardContext 及其目标快照在运行时冻结；raw/attachments 仍遵守已有上下文的 readonly 契约，业务不得修改。需要读取 QQ API 时可显式注入 QQApi 等服务，传入 ctx.signal，并自行 await；注入服务发起的请求不自动成为上下文发送操作。

`@UseGuards(A, B)` 按 A、B 顺序执行。模块级先于控制器类级，类级先于方法级；同一位置叠加多个 UseGuards 时按代码从上到下执行。基类的类级 Guard 先于派生类的类级 Guard；继承方法保留方法级声明，覆写方法使用覆写后的方法声明，不叠加基类方法策略。未重新注册的覆写方法沿用现有规则：不会成为路由。

所有 Guard 必须通过才调用业务；拒绝或异常立即停止后续 Guard。正常拒绝不是错误，不调用 onError，不增加 failed；提示发送失败仍按 send 错误处理。Guard 抛错、返回 undefined/数字/非法对象是执行错误，只上报，不把异常原文回复给用户。对象放行形式 `{ allow: true }` 不属于 API，请返回 true。

Guard 从 Controller 所属模块解析，遵守 imports/exports 和普通 Provider 生命周期。未注册、不可见或歧义的令牌在实例构造前报错；实例/异步工厂结果没有 canActivate 时，在 create 返回前报错并执行初始化回滚。默认单例，因此将当前请求状态留在方法局部变量，不放在实例字段。

模块 Guard 作用于本模块直接注册的 Controller，类级 Guard 作用于该 Controller 的 Command 和 OnButton；原始 On 观察器仍独立执行，便于记录原始事件。在 On 方法上显式加 Guard/Cooldown 会在启动时报 CONFIG。HelpModule 的列表不执行被列出命令的 Guard，不自动隐藏受限命令；实际调用仍检查权限。

## 命令冷却

```ts
@Command('查询', { aliases: ['查'] })
@UseGuards(QueryPermissionGuard)
@Cooldown({ scope: 'user', durationMs: 3000 })
query(@City() city: string): string {
  return `查询城市：${city}`;
}
```

`Cooldown(options)` 用于 Command / OnButton 方法，每个方法最多一个。durationMs 为 1～2147483647 的整数。配置复制并冻结；未声明的字段、错误范围、空提示等在装饰器求值时拒绝。

| scope     | 同一处理器内共享冷却的范围                       |
| --------- | ------------------------------------------------ |
| `user`    | 同一会话内的同一用户；不同群独立，群聊与私聊独立 |
| `session` | 同一个群或同一私聊；群内所有用户共享             |
| `command` | 此命令或按钮处理器的所有用户、会话共享           |

每个处理器各自计时；命令及其别名共享一份记录。按钮处理器与命令是不同路由，默认不共享冷却。框架不将群 member_openid 与私聊 user_openid 猜测为同一身份；跨会话统一身份策略由业务另行实现。

`message` 可省略（默认提示剩余秒数）、设为自定义非空字符串，或设为 false 静默拒绝。重复触发不会延长冷却；只有成功占用才设置期限。

执行顺序：定位路由 → 按顺序执行 Guard → 解析并绑定命令参数 → 原子检查并占用冷却 → 业务方法 → 返回消息发送。Guard 拒绝及参数错误均不占用冷却。检查与占用之间没有 await，同进程中的并发调用不能同时取得同一个名额。

冷却从即将调用业务方法时起算；业务抛错或发送失败也保留名额，避免已产生部分副作用后立即重试。超过冷却时间即可再次调用，即使上一次业务仍在运行，因此它不是业务执行互斥锁。

状态按应用保存在进程内，重启会重置，多个进程独立。`execution.cooldownMaxEntries` 默认 10000，限制整个应用的记录数；达到容量时先清理过期项，仍满则报 RESOURCE_LIMIT 并阻止业务，不淘汰有效记录放行。使用单调时钟；每应用按需使用一个不阻止进程退出的定时器，每秒清理，读取时立即识别过期，不需要等待清理周期。关闭时撤销定时器并清空记录。

## 按钮、错误和关闭

- 自动交互确认继续表示“收到事件”，不表示 Guard 放行或业务成功。
- manual 模式下，如果 Guard/冷却拒绝或检查执行出错，业务处理器不会运行，框架负责确认收到（code=0）；确认会在等待拒绝提示发送之前发起。已进入业务处理器时仍由业务负责 manual 确认。
- 指令提示引用原消息回复；按钮提示通过普通 send 发送，不把 interactionId 当作消息引用。普通发送是否允许由 QQ 平台权限决定，失败按已有机制上报，不自动改换引用。
- 提示与确认都进入原有操作跟踪，平台重复投递不重复执行业务或发提示。
- 新增 onError 阶段 guard / cooldown；业务处理器保留 command / button，发送和确认分别保留 send / interaction-ack。
- 关闭先按既有期限排空在途任务；超时后取消 Guard 的等待。迟到的放行结果不能继续执行业务或重新占用冷却。用户自己的异步操作仍需配合 ctx.signal；框架不能硬终止任意 JS。

## 完整业务例子

本节文件链接及验证记录位于公开的源码仓库，可直接访问；以下 npm 命令在源码目录执行。已安装 SDK 的独立应用可参考前文实现自己的模块。

```sh
npm run example:business
```

该离线入口不加载 .env，不连接 QQ。它运行真实模块、DI、装饰器和消息编码，展示无权限、缺参、成功查询、别名冷却、群聊查询、按钮刷新和帮助。天气与空气质量均明确标注为本地合成演示数据，不是实时查询。

| 文件                                                                                                                      | 职责                                                    |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [city.decorator.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/city.decorator.ts)                 | 用 Slot 封装可复用的 City 装饰器                        |
| [permission.service.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/permission.service.ts)         | 通过注入配置检查私聊及群内用户白名单                    |
| [query-permission.guard.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/query-permission.guard.ts) | 使用权限服务，返回放行或拒绝提示                        |
| [query.service.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/query.service.ts)                   | 演示数据查询与结果格式化，业务数据源替换点              |
| [query.controller.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/query.controller.ts)             | City/Slot/Rest/Option、类级 Guard、方法冷却、消息与按钮 |
| [app.module.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business/app.module.ts)                         | 组装 HelpModule、配置令牌、Providers 和 Controller      |
| [business.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business.ts)                                      | 离线启动并投递示例事件                                  |
| [business-qq.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/business-qq.ts)                                | 复用同一业务模块的真实 WS / Webhook 启动入口            |
| [business.test.ts](https://github.com/abandon-jw3/dou-bot/blob/main/tests/business.test.ts)                               | 对真实业务模块进行离线验收                              |

真实入口运行命令为 `npm run example:business:qq`。它从本地环境读取已有 QQ_APP_ID / QQ_APP_SECRET；另配置 DEMO_PRIVATE_USERS（私聊 user_openid，逗号分隔）、DEMO_GROUP_ID（group_openid）及 DEMO_GROUP_USERS（该群的 member_openid，逗号分隔）。未配置白名单则拒绝查询。填写事件提供的实际 OpenID，不使用日常 QQ 号推测身份；这些配置不是 QQ 群管理员身份查询。

QQ_TRANSPORT=webhook 时使用已有 PORT 与 /qq 配置，否则 WS。源码工程示例通过相对路径引用 SDK；复制到独立业务工程后，安装 SDK 并将这些导入改为 dou-bot，测试入口改为 dou-bot/testing。按既定方案由宿主处理退出信号并等待 close。

初次交付完成离线示例与自动测试，随后于 2026-09-30 使用 `probe:controls` 在授权机器人的群聊与私聊验证了 Guard、参数、冷却、允许/拒绝按钮及 manual 兜底确认。探针复用 City 和 QueryService，使用临时绑定会话控制测试范围；business-qq 常驻入口本轮未运行。具体后台结果与客户端确认状态见 [验证记录](https://github.com/abandon-jw3/dou-bot/blob/main/docs/validation-report.md)。公网 Webhook 验收仍等待 HTTPS 部署入口。
