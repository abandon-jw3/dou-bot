# 全部装饰器示例

本模块覆盖项目当前安装的 **dd-bot 0.4.0 全部 20 个公开装饰器**。源码中的中文注释说明了用途、参数、执行顺序和容易混淆的行为。

`AppModule` 已导入 `ExampleModule`，按根目录 README 启动后即可发送 `/example` 或 `/示例` 查看入口。最小的 `/hello` 示例仍在模块外。

## 源码索引

| 装饰器               | 用途                                            | 示例位置                                                                                                                      |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `@Module`            | 组合 imports、controllers、providers 与 exports | [example.module.ts](example.module.ts)                                                                                        |
| `@Injectable`        | 声明交给容器创建的服务或 Guard                  | [example.service.ts](example.service.ts)、[example.guard.ts](example.guard.ts)                                                |
| `@Inject`            | 使用 Symbol 令牌注入接口配置                    | [example.service.ts](example.service.ts) 的构造函数                                                                           |
| `@Controller`        | 声明命令、按钮或事件处理器所在的类              | [example.controller.ts](example.controller.ts)                                                                                |
| `@Command`           | 注册命令名称、别名和帮助说明                    | [example.controller.ts](example.controller.ts) 的 `index` 等方法                                                              |
| `@Arg`               | 按下标取值，校验必填、类型、范围和默认值        | [example.controller.ts](example.controller.ts) 的 `positional`                                                                |
| `@Args`              | 获取命令后完整的分词快照                        | [example.controller.ts](example.controller.ts) 的 `allArguments`                                                              |
| `@Option`            | 读取长短选项，转换字符串、整数和布尔值          | [example.controller.ts](example.controller.ts) 的 `options`                                                                   |
| `@Slot`              | 按 match 或 choices 匹配任意位置的分词          | [example.controller.ts](example.controller.ts) 的 `slots`                                                                     |
| `@Rest`              | 按原顺序收集尚未消费的普通分词                  | [example.controller.ts](example.controller.ts) 的 `slots`                                                                     |
| `@Ctx`               | 注入命令、按钮或原始事件各自的上下文            | [example.controller.ts](example.controller.ts) 的 `context`、`confirmButton`                                                  |
| `@UseGuards`         | 方法级或类级的调用条件检查                      | [example.controller.ts](example.controller.ts) 的 `groupOnly`、[example-private.controller.ts](example-private.controller.ts) |
| `@Cooldown`          | 按用户、会话或处理器限制调用频率                | [example.controller.ts](example.controller.ts) 的 `cooldown`                                                                  |
| `@On`                | 精确监听 QQ 原始事件名                          | [example-events.controller.ts](example-events.controller.ts)                                                                  |
| `@OnButton`          | 根据 callback 按钮 ID 处理点击                  | [example.controller.ts](example.controller.ts) 的 `confirmButton`                                                             |
| `@GroupOnly`         | 仅群聊；可用于类和方法                          | [example-access.controller.ts](example-access.controller.ts)                                                                  |
| `@PrivateOnly`       | 仅私聊；与群聊限制冲突时启动报错                | [example-access.controller.ts](example-access.controller.ts)                                                                  |
| `@UsersOnly`         | 指定 OpenID，可按场景或群限制                   | [example-access.controller.ts](example-access.controller.ts)                                                                  |
| `@GroupRoles`        | 指定当前群消息发送者角色                        | [example-access.controller.ts](example-access.controller.ts)                                                                  |
| `@GroupManagersOnly` | 当前群主或管理员                                | [example-access.controller.ts](example-access.controller.ts)                                                                  |

## 可以直接尝试的命令

| 输入                                            | 观察结果                                      |
| ----------------------------------------------- | --------------------------------------------- |
| `/example` 或 `/示例`                           | 所有示例的入口列表                            |
| `/example-arg 小明`                             | 使用默认次数，回复一次问候                    |
| `/example-arg 小明 2`                           | 将第二个位置参数转换为整数，回复两行问候      |
| `/example-arg 小明 0`                           | 不满足 1～3 的范围，收到参数和用法提示        |
| `/example-args 小明 "两个 单词" --flag`         | 查看三个分词；带空格的引号内容是一个元素      |
| `/example-option --name 小明 --times 2 --shout` | 长选项和布尔开关                              |
| `/example-option -n 小明 -t 2 --shout=false`    | 短选项与显式 false                            |
| `/example-slot 明天 散步 北京 带伞 --detail`    | 城市=北京，活动=散步，剩余=明天 / 带伞        |
| `/example-slot 明天 北京 散步 带伞 --detail`    | 交换城市与活动的位置，解析结果相同            |
| `/example-slot 上海 骑行`                       | 没有剩余参数，Rest 为 `[]`                    |
| `/example-context`                              | 通过 `ctx.reply()` 手动回复当前会话           |
| `/example-group`                                | 方法级 Guard：群聊放行，私聊提示拒绝          |
| `/example-private`                              | 类级 Guard：私聊放行，群聊提示拒绝            |
| `/example-cooldown`，随后立即发送 `/示例冷却`   | 同会话同用户共享 3 秒冷却；别名不能绕过       |
| `/example-button`                               | 发送带“确认示例”按钮的 Markdown，点击进入回调 |
| `/example-events`                               | 查看消息事件计数，包含当前这条消息，重启归零  |
| `/help example-slot`                            | 查看根据装饰器声明生成的帮助                  |

`example-slot` 只是回显解析结果，支持北京、上海、广州以及散步、骑行，不请求外部业务接口。

## 内置权限示例

| 输入                      | 行为                                                |
| ------------------------- | --------------------------------------------------- |
| `/example-group-only`     | 群聊放行，私聊拒绝                                  |
| `/example-private-only`   | 私聊放行，群聊拒绝                                  |
| `/example-users`          | 仅指定私聊 OpenID；请先替换源码中的占位 ID          |
| `/example-owner`          | 仅当前群主                                          |
| `/example-managers`       | 当前群主或管理员；缺失角色时拒绝                    |
| `/example-manager-button` | 群主/管理员可以发送，按钮配置 QQ 原生管理者点击权限 |

内置装饰器无需注册 Provider。UsersOnly 的 ID 是 OpenID，不是 QQ 号；可通过 scene 或 groupId 限定匹配范围。装饰器配置是静态快照，动态名单继续使用自定义 Guard。

角色装饰器只用于命令，直接或通过类级声明作用于 OnButton 会在启动时报错。管理者按钮使用 `permission: { type: 'managers' }`，映射原生 type=1；发送到私聊会在请求前被拒绝。命令按钮对应的命令若需要权限，也要声明自己的规则。

原有 example-group/example-private 保留自定义 UseGuards 的写法，用来对照内置装饰器。离线测试不验证 QQ 对真实点击者的拦截，该项仍需实机验收。

## 阅读时注意

- 命令前缀在启动配置中统一决定，装饰器中的命令名不带 `/`。本表按项目默认前缀编写。
- `@Args` 是完整分词快照，不参与消费；`@Rest` 才收集未被其他声明消费的普通分词。未知选项、重复 Slot 和缺参不能交给 Rest 吞掉。正文需要 `--literal` 这样的词时，可使用 `--` 终止选项解析。
- 类型转换必须在装饰器选项中声明，例如 `type: 'integer'`。主入口开启了 `commands.invalidInput: 'reply'`，因此输入错误会回复用法提示。
- 类依赖使用值导入，接口配置使用 `@Inject` 的令牌。Guard 和服务都需要在模块 providers 中注册；服务计数用于展示多个控制器共享同一个实例。
- 原始 `@On` 观察器先执行并返回 void，不阻止后续命令；它只统计事件，不会自动回复普通聊天。群聊普通消息是否投递由 QQ 的能力和权限决定。
- 命令返回字符串可以自动回复；手动 `ctx.reply()` 后返回 void。`@OnButton` 必须返回 void，业务回复使用 `ctx.send()`，仍受 QQ 发送权限限制。
- 按钮默认自动 ACK，仅表示已收到点击。这里的回调允许所有点击者并校验固定数据；它不实现权限业务。若全局改成手动确认，需在处理器中调用 `await ctx.ack()`。

## 离线验证

根目录运行 `npm test` 或 `npm run check`。[tests/example.test.ts](../../tests/example.test.ts) 通过已安装 SDK 的 `dd-bot/testing` 验证上述行为，不使用真实凭证或 QQ 网络。

只需要最小初始项目时，移除根模块中 `ExampleModule` 的导入和 `imports` 项即可停用全部示例；该目录集中保存了所有演示代码。
