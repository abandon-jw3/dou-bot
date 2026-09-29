# dd-bot

面向 QQ 官方机器人群聊和私聊的 TypeScript 装饰器框架。Node.js 24+，TypeScript 固定为 **5.9.3**，生产依赖为 `reflect-metadata` 和 `ws`。

当前开发版 0.3.0 提供可运行 SDK、离线测试入口和 WS / Webhook 实现，包含无序 Slot、Rest、选项、帮助、Guard、命令冷却及完整业务示例。项目暂为 private；正式公开分发的包名和许可证由项目所有者确定。

## 快速验证

```sh
npm ci --ignore-scripts
npm run check
npm run example:offline
npm run example:query
npm run example:business
```

离线示例使用同一套模块、DI、指令分发、QQ 消息编码与生命周期，在内存中替换网络入口和 HTTP 服务。预期输出：

```text
private: 你好，Ada Lovelace！
group: 你好，朋友！
```

它不读取本地 QQ 凭证，也不会向真实会话发消息。

`example:query` 展示 `查询 北京 天气`、`查询 天气 北京`、剩余参数、`--page` 及帮助提示，使用相同的离线入口。完整最终用法见 [命令参数指南](docs/command-parameters.md) 和 [查询示例](examples/query.ts)。

`example:business` 将自定义 `@City()`、白名单权限服务、Guard、冷却、查询服务、Markdown 与按钮组合成一个可复制的业务模块，数据为明确标注的合成示例。见 [执行控制指南](docs/execution-controls.md) 和 [业务 Controller](examples/business/query.controller.ts)。

## 编写机器人

```ts
import { Arg, BotFactory, Command, Controller, Injectable, Module } from 'dd-bot';

@Injectable()
class Greetings {
  hello(name: string): string {
    return `你好，${name}！`;
  }
}

@Controller()
class Commands {
  constructor(private readonly greetings: Greetings) {}

  @Command('hello', { aliases: ['hi'] })
  hello(@Arg(0) name: string = '朋友'): string {
    return this.greetings.hello(name);
  }
}

@Module({ providers: [Greetings], controllers: [Commands] })
class AppModule {}

const app = await BotFactory.create(AppModule, {
  appId: process.env.QQ_APP_ID!,
  secret: process.env.QQ_APP_SECRET!,
  transport: { type: 'ws' },
});

await app.start();
// 宿主收到退出信号时调用并等待 app.close()。
```

运行 TypeScript 时先用 tsc 编译，启用 `experimentalDecorators`、`emitDecoratorMetadata`；注入的类使用值导入。框架加载 `reflect-metadata/lite`。仅类型导入不能提供自动注入所需的运行时令牌。

## 本地凭证与真实连接

将 `.env.example` 复制为 `.env`，填写自己的测试机器人凭证。`.env` 不进入 Git 或 npm 包。

```sh
npm run diagnose:auth
npm run diagnose:ws
npm run example:qq
```

`diagnose:auth` 只检查凭证与网关；`diagnose:ws` 会建立 WS、等待 READY 后关闭，没有消息处理器。`example:qq` 常驻并处理 `/hello`，运行前应确认 Koishi 等其他进程已停用，避免同一机器人的连接相互影响。

`npm run probe:live` 是带随机口令、最长 10 分钟的交互诊断，仅响应本次打印的测试命令，并验证心跳；`npm run probe:live -- --group-only` 只验证群聊。每次运行输出独立保存到 work/runs，测试重编译不会删除正在运行的例子。

`npm run probe:media` 验证图片、Markdown 和回调按钮；加 `-- --buttons-only --no-prefix` 可只验证空前缀与按钮。`npm run probe:reconnect` 自行断开当前探针的 WS，检查 RESUME 和恢复后的心跳；不发送消息。各探针应逐个运行。

`npm run probe:controls` 提供最长 10 分钟的 Guard/参数/冷却/按钮实机验收。启动后打印随机命令，按顺序在私聊和测试群发送：拒绝测试、缺参测试、有效查询、30 秒内的别名复测，再点击允许/拒绝按钮。首次拒绝测试仅在内存绑定每种场景的一个用户与会话，其他会话不响应；使用 manual 确认模式验证按钮拦截兜底。只记录场景、阶段、成功状态与错误分类，不记录会话身份或消息原文。输出在 work/live-controls，全部步骤完成或超时后自动关闭。

截至 2026-09-29，实际鉴权、网关、WS READY、持续心跳及受控断线后的 RESUME 已验证；群聊带 @ / 不带 @ 指令，以及群聊和私聊的空前缀、图片、原始 Markdown、按钮点击与确认均已实测。Webhook 已通过本地真实 HTTP、签名及 WS/Webhook 同输入对照测试；用户确认公网验收留待部署入口就绪后进行。完整边界与待办见 [验证记录](docs/validation-report.md)。

## Webhook

独立监听：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

由部署环境提供 HTTPS 回调入口。也可设置 `listen: false`，将 `app.webhookHandler()` 挂载到自有 Node HTTP server；必须保留原始路径和未读取的原始请求体。先完成 `app.start()` 再接入流量。

包含地址验证、Ed25519 原始字节验签、签名新鲜度检查、有界读取、重复事件抑制和异步业务确认。无签名挑战的输入范围受到限制，避免它成为任意事件签名入口。

## 业务 API

- `@Module`：imports / providers / controllers / exports。
- `@Injectable`、`@Inject`：类单例、值、异步工厂及显式令牌。
- `@Command`、`@Arg`、`@Args`、`@Ctx`：指令与参数绑定，支持引号和转义。
- `@Slot`、`@Rest`、`@Option`：无序匹配、剩余参数和长短选项；`@Arg(index, options)` 支持显式类型、必填、默认值与范围校验。
- `HelpModule`：显式导入后注册 help / 帮助，按声明生成用法；`commands.invalidInput: 'reply'` 可回复输入错误。
- `@UseGuards`：类级与方法级访问检查，可注入服务并异步判断；适用于命令和按钮。
- `@Cooldown`：按当前会话内用户、会话或整个命令设置间隔；Guard/参数通过后原子占用，有容量与过期清理。
- `@On`：精确 QQ 事件名的观察器；异常不会阻断对应指令。
- `@OnButton`：按钮回调；交互确认与消息回复分开。
- `text`、`image`、`markdown`、`keyboard`、`button`：消息工具；Markdown 使用原始内容，键盘使用内联按钮，无需模板 ID。
- `QQClient`、`QQApi`、`LOGGER`：可注入的框架服务。

Controller 属于模块内部入口，可用 app.get 获取所在模块的实例；不作为跨模块导出或注入的 Provider。需要共享逻辑时放到 Injectable 服务中。

指令返回字符串或消息对象会自动回复。使用 `ctx.reply()` 时返回 void，避免重复回复；消息按原始 messageId 共享回复序号。`ctx.send()` 是显式无引用发送，是否允许由 QQ 平台权限决定。上下文结束后不可继续复用其发送方法。

群聊同时接收 `GROUP_AT_MESSAGE_CREATE` 和 `GROUP_MESSAGE_CREATE`。正文开头的 `<@id>` / `<@!id>` 只有与本事件 `mentions[].is_you === true` 的身份匹配时才会移除，随后按指令前缀解析。其他人的提及和参数中的提及保留；原始正文仍可从 `ctx.raw.d` 读取。没有结构化自身标记时不猜测提及归属。

指令不要求 @：只要 QQ 推送了该条群消息，直接发送 `/hello` 与 `@机器人 /hello` 共用同一个 `@Command('hello')`。这两种方式已在用户的测试群验证。默认前缀为 `/`，可通过 `commands.prefix` 更换或取消：

| BotFactory.create 配置         | `@Command('hello')` 的调用方式 |
| ------------------------------ | ------------------------------ |
| 不配置 commands                | `/hello`                       |
| `commands: { prefix: '!' }`    | `!hello`                       |
| `commands: { prefix: 'bot:' }` | `bot:hello`                    |
| `commands: { prefix: '' }`     | `hello`                        |

当前每个应用配置一个前缀字符串，群聊与私聊共用；前缀可以为空但不能包含空白。设置空字符串会替换默认 `/`，不会额外保留 `/` 作为另一种前缀。装饰器内仍写指令名本身，别名遵循同一前缀配置。

空前缀按消息开头的完整指令名匹配：`hello Ada` 可以调用 hello，`helloThere` 和 `say hello` 不会调用它。未注册指令被忽略；普通文本如果恰好以已注册指令名及空白开头，也会作为该指令执行。空前缀已在真实 QQ 群聊与私聊验证。

内联按钮默认将点击后文案设为原文案，避免点击后文字消失。可用 `visitedLabel` 自定义点击后文案，显式空字符串也会保留。模板 Markdown 和模板键盘不属于本版 API，旧式输入会在发请求前被拒绝。

## 测试入口

```ts
import { createTestApplication } from 'dd-bot/testing';

const testBot = await createTestApplication(AppModule);
await testBot.app.start();
try {
  await testBot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'test-message', author: { id: 'test-user' }, content: '/hello Ada' },
  });
  console.log(testBot.messages);
} finally {
  await testBot.app.close();
}
```

该入口只用于测试：`messages` 保存默认模拟发送结果，`acknowledgments` 保存交互确认，`errors` 收集框架错误；`enqueue()` 返回即时接纳结果，`dispatch()` 等待处理结束，`flush()` 等待队列空闲。可用 respond 回调覆盖指定 HTTP 响应，以测试错误和超时；被覆盖的响应不进入默认发送记录。

## 验证命令与限制

`npm run check` 执行类型、Lint、格式、文档链接、构建、测试和打包消费者检查；`npm run coverage` 生成映射至原始 TS 的覆盖率。首版按 Windows 验收；Windows/Linux CI 工作流已提供，远端运行留待仓库接入。

`npm run benchmark` 在离线模式测量冷导入、合成指令吞吐和采样 RSS，原始 JSON 写入 work/benchmark-latest.json；不读取真实凭证。公开 API 按设计契约 1.4 维护，当前检查结果见 [验证记录](docs/validation-report.md)。

`npm run soak -- 180000` 执行三分钟本地持续运行检查，混合消息与按钮、重复投递、过载及接口故障。它使用真实时钟、短 TTL 和模拟网络，采样时主动 GC，结果保存到 work/soak-latest.json。0.1.1 的已保存运行处理了 393,088 个事件，关闭后受管资源归零；持续负载仍是旧版基线。0.3.0 的 Guard、参数、冷却和按钮已在授权机器人的群聊/私聊完成 WS 后台验证，详见验证记录。

运行时只提供进程内队列、去重及回复序号状态。确认后发生进程崩溃可能丢失尚未处理的任务；WS RESUME 不保证服务端永远保留重放。没有跨进程“恰好一次”承诺。关闭期限只能取消受管请求和协作任务，不能硬终止不响应 signal 的用户 JavaScript。

设计、协议假设与版本取舍见 [开发方案](docs/development-plan.md)、[严格审查](docs/review-report.md)、[技术选型](docs/technology-selection.md)。完整公开声明由 build 生成。
