# 装饰器参考

从 `dou-bot` 导入，按功能选择：

| 功能       | 装饰器                                                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组织业务   | [Module](#module)、[Controller](#controller)、[Injectable](#injectable)、[Inject](#inject)                                                                                 |
| 接收输入   | [Command](#command)、[OnAttachment](#onattachment)、[OnButton](#onbutton)、[On](#on)                                                                                       |
| 读取文字   | [Arg](#arg)、[Args](#args)、[Option](#option)、[Slot](#slot)、[Rest](#rest)                                                                                                |
| 读取附件   | [Attachments](#attachments)、[Images](#images)                                                                                                                             |
| 读取身份   | [User](#user)、[UserId](#userid)、[Group](#group)、[GroupId](#groupid)、[Role](#role)                                                                                      |
| 使用上下文 | [Ctx](#ctx)                                                                                                                                                                |
| 限制访问   | [UseGuards](#useguards)、[GroupOnly](#grouponly)、[PrivateOnly](#privateonly)、[UsersOnly](#usersonly)、[GroupRoles](#grouproles)、[GroupManagersOnly](#groupmanagersonly) |
| 限制频率   | [Cooldown](#cooldown)                                                                                                                                                      |

准备业务数据用 [UseMiddleware](#usemiddleware)，读取数据用 [ContextValue](#contextvalue) 或 ctx.state.get。

处理器参数只能声明一个来源。完整运行示例见 [示例目录](../examples/hello.md)。

## Module {#module}

注册模块的依赖、服务和控制器。

```ts
Module(metadata: ModuleMetadata): ClassDecorator
```

- 用于模块类，配置 imports、providers、controllers、exports、guards。
- 模块类不自动实例化；guards 只保护本模块直接注册的控制器。

[用法与示例](../guide/modules.md)。

## Injectable {#injectable}

标记需要构造注入的服务或 Guard。

```ts
Injectable(): ClassDecorator
```

- 还需在模块 providers 注册，默认单例。
- 每条消息的数据放在方法局部变量中。

[用法与示例](../guide/modules.md)。

## Inject {#inject}

为构造参数指定运行时令牌。

```ts
Inject(token: InjectionToken): ParameterDecorator
```

- 令牌可用类、字符串或 Symbol；接口配置通常用 Symbol。
- 写法：`constructor(@Inject(SETTINGS) private readonly settings: Settings) {}`。

[用法与示例](../guide/modules.md)。

## Controller {#controller}

标记命令、按钮、附件或事件处理器所在的类。

```ts
Controller(): ClassDecorator
```

- 还需在模块 controllers 注册。
- Controller 不作为跨模块共享 Provider。

[用法与示例](../guide/commands.md)。

## OnAttachment {#onattachment}

处理用户直接上传的附件。

```ts
OnAttachment(options?: OnAttachmentOptions): MethodDecorator
```

- 用于控制器实例方法；filename、extension、kind 必须命中同一附件，省略条件时匹配全部附件。
- invalidInput 默认 report，可设 reply；返回消息自动回复，手动回复后返回 void。
- 支持 Guard、冷却、附件/身份参数和 prompt；不支持文字参数。
- 多个匹配处理器独立顺序执行，prompt 和已识别命令优先。

[用法与示例](../guide/attachments.md#用户直接上传文件)。

## Attachments {#attachments}

注入 `readonly Attachment[]`。

```ts
Attachments(options?: AttachmentOptions): ParameterDecorator
```

- 用于 Command、OnAttachment 参数；分别选择当前消息全部附件或本处理器匹配集合。
- 选项为 name、description、minCount、maxCount；默认最少 0 个、无上限。
- 数量边界须为非负安全整数且上限不小于下限；校验失败不占冷却。
- 每个参数获得浅冻结副本，保留顺序和重复项，不消费文字。

[用法与示例](../guide/attachments.md)。

## Images {#images}

选择图片并注入 `readonly Attachment[]`。

```ts
Images(options?: AttachmentOptions): ParameterDecorator
```

- 与 Attachments 的选项、位置和数量规则相同，只保留具体的 image MIME。
- 适合用户将指令和图片同条发送。

[用法与示例](../guide/attachments.md#指令与图片同条发送)。

## User {#user}

读取当前消息发送者或按钮操作者。

```ts
User(): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment 参数，无配置项。
- 注入冻结的 UserInfo：id，以及当前消息提供的可选 username、bot、memberRole。
- 不查询额外资料；按钮只提供用户 ID。

[用法与示例](../guide/identity.md)。

## UserId {#userid}

读取当前用户 OpenID。

```ts
UserId(): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment 参数，无配置项。
- 注入 string，与 ctx.userId 一致；按钮以本次点击者为准。

[用法与示例](../guide/identity.md)。

## Group {#group}

读取当前群信息。

```ts
Group(): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment 参数，无配置项。
- 群聊注入冻结的 GroupInfo（仅 id），私聊为 undefined；不查询群名或成员列表。

[用法与示例](../guide/identity.md)。

## GroupId {#groupid}

读取当前群 OpenID。

```ts
GroupId(): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment 参数，无配置项。
- 注入 string 或 undefined；私聊无群 ID，OpenID 不是显示用群号。

[用法与示例](../guide/identity.md)。

## Role {#role}

读取当前群消息作者的角色。

```ts
Role(): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment 参数，无配置项。
- 注入 member、admin、owner 或 undefined；私聊、按钮和未知角色均为 undefined。
- 只读取信息，不限制执行；权限检查使用 GroupRoles。

[用法与示例](../guide/identity.md)。

## Command {#command}

注册命令处理器。

```ts
Command(name: string, options?: CommandOptions): MethodDecorator
```

- 用于控制器实例方法；name 不带前缀，options 可设 aliases、description。
- 返回字符串或消息对象自动回复；手动 reply 后返回 void。
- 名称或别名冲突会导致应用创建失败。

[用法与示例](../guide/commands.md)。

## On {#on}

按精确 QQ 事件名监听原始事件。

```ts
On(eventName: string): MethodDecorator
```

- 用于控制器实例方法，例如 `@On('C2C_MESSAGE_CREATE')`。
- 只支持 Ctx 参数，返回 void，不自动回复。
- 不受模块/类 Guard 保护，方法上不能添加 Guard 或 Cooldown。

[用法与示例](../guide/events.md)。

## OnButton {#onbutton}

处理 callback 按钮点击。

```ts
OnButton(buttonId: string): MethodDecorator
```

- 用于控制器实例方法，buttonId 与 button.callback 的第一个参数一致。
- 支持 Ctx 和身份参数；返回 void，业务回复使用 ctx.send。
- 不处理 link/command 按钮；确认方式见按钮指南。

[用法与示例](../guide/buttons.md)。

## Ctx {#ctx}

注入当前处理器的上下文。

```ts
Ctx(): ParameterDecorator
```

- 用于 Command / OnAttachment：MessageContext；OnButton：ButtonContext；On：QQEventContext。
- 无配置项；各上下文能力不同，例如按钮没有 reply/prompt。

[用法与示例](./contexts.md)。

## Arg {#arg}

按固定位置读取命令参数，下标从 0 开始。

```ts
Arg(index: number, options?: ArgumentOptions): ParameterDecorator
```

- 无 options 时注入 string 或 undefined；配置 type 才执行类型转换。
- options 可设 required、default、choices、min/max、name、description。
- default 不能与 required: true 共用；TS 类型注解不触发转换。

[用法与示例](../guide/parameters.md)。

## Args {#args}

读取命令后全部分词。

```ts
Args(): ParameterDecorator
```

- 注入 string[]，包含选项名、选项值和 `--`，不含命令名。
- 不参与消费，也不代替 Rest；使用普通数组参数，不写 `...words`。

[用法与示例](../guide/parameters.md)。

## Option {#option}

读取命令中的长选项和单字母短别名。

```ts
Option(name: string, options?: OptionOptions): ParameterDecorator
```

- 默认 type=string、required=false；alias 为单个 ASCII 字母，其余配置同 Arg。
- 示例：`@Option('page', { alias: 'p', type: 'integer', default: 1 })`。
- 不支持合并短选项；未知或重复选项报错，布尔 false 写成 `--flag=false`。

[用法与示例](../guide/parameters.md#选项语法)。

## Slot {#slot}

从任意位置匹配一个普通分词。

```ts
Slot(name: string, options: SlotOptions): ParameterDecorator
```

- 用于命令参数；name 在命令中唯一，至少提供 choices 或 match，同时提供时取交集。
- required 默认 false，可设 default；match 同步返回布尔值，normalize 可同步转换匹配后的字符串。
- 重复值或多个 Slot 同时命中会报错，不按声明顺序抢占。

[用法与示例](../guide/parameters.md)。

## Rest {#rest}

按原顺序收集剩余普通参数。

```ts
Rest(options?: RestOptions): ParameterDecorator
```

- 用于命令参数，注入 string[]；无剩余时为 []，options 仅 name、description。
- 每个命令最多一个，始终最后收集；不掩盖缺参、歧义或选项错误。

[用法与示例](../guide/parameters.md)。

## UseMiddleware {#usemiddleware}

在处理器执行前准备上下文数据。

```ts
UseMiddleware(...middlewares: readonly InjectionToken<ContextMiddleware>[]): ClassDecorator & MethodDecorator
```

- 用于模块类、控制器类，以及 Command、OnButton、OnAttachment 方法。
- 传可见的 Provider 令牌，prepare 可同步或异步，只返回 void。
- 在 Guard 之前依次执行；模块规则不传播到 imports，原始 On 不执行。

[用法与示例](../guide/context.md)。

## ContextValue {#contextvalue}

把中间件注册的数据注入处理器参数。

```ts
ContextValue<T>(key: ContextKey<T>): ParameterDecorator
```

- 用于 Command、OnButton、OnAttachment，直接注入 Key 对应的完整值。
- 在其他参数通过后读取，冷却之前完成；同 Key 共享加载结果。
- 不消费输入、不进入帮助，不处理业务默认值或字段选择。

[用法与示例](../guide/context.md)。

## UseGuards {#useguards}

添加自定义权限检查。

```ts
UseGuards(...tokens: InjectionToken<CanActivate>[]): ClassDecorator & MethodDecorator
```

- 用于模块类、控制器类，或 Command、OnButton、OnAttachment 方法。
- 传所属模块可见的 Provider 令牌，不传实例；按声明顺序执行。
- 不同层级规则累加，重复声明会重复执行。

[用法与示例](../guide/guards.md)。

## GroupOnly {#grouponly}

只允许群聊。

```ts
GroupOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

- 用于模块类、控制器类，或 Command、OnButton、OnAttachment 方法。
- message 省略用默认提示，非空字符串自定义提示，false 静默拒绝。
- 无需额外 Provider；与 PrivateOnly 冲突时创建失败。

[用法与示例](../guide/access.md)。

## PrivateOnly {#privateonly}

只允许私聊。

```ts
PrivateOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

- 用于模块类、控制器类，或 Command、OnButton、OnAttachment 方法。
- message 配置同 GroupOnly；模块规则只作用于本模块控制器。

[用法与示例](../guide/access.md)。

## UsersOnly {#usersonly}

按当前用户 OpenID 限制调用者。

```ts
UsersOnly(userIds: readonly string[], options?: UsersOnlyOptions): ClassDecorator & MethodDecorator
```

- 用于模块类、控制器类，或 Command、OnButton、OnAttachment 方法。
- 名单不能为空，支持 scene、groupId、message；groupId 隐含群聊，不能配 private。
- OpenID 不是 QQ 号，不转换群聊和私聊身份；动态名单使用自定义 Guard。

[用法与示例](../guide/access.md)。

## GroupRoles {#grouproles}

只允许指定群角色。

```ts
GroupRoles(...roles: GroupRole[]): ClassDecorator & MethodDecorator
```

- 至少一个 member、admin、owner，命中任一项即可；使用默认拒绝提示。
- 用于模块类、控制器类，或 Command、OnAttachment 方法；不能施加到 OnButton。
- 缺失或未知角色拒绝，不推测身份。

[用法与示例](../guide/access.md)。

## GroupManagersOnly {#groupmanagersonly}

只允许群主或管理员。

```ts
GroupManagersOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

- 等同允许 owner、admin；message 可省略、自定义或设 false。
- 用于模块类、控制器类，或 Command、OnAttachment 方法；不能施加到 OnButton。
- 按钮点击资格使用 `permission: { type: 'managers' }`。

[用法与示例](../guide/access.md)。

## Cooldown {#cooldown}

限制处理器的调用频率。

```ts
Cooldown(options: CooldownOptions): MethodDecorator
```

- 用于 Command、OnButton、OnAttachment 方法，每个方法最多一个。
- scope 为 user、session、command；durationMs 为 1～2147483647 的整数。
- message 默认显示剩余时间，可自定义或设 false；user 指同会话同用户。
- Guard 与参数通过后才占用，业务失败不退还；命令别名共享冷却。

[用法与示例](../guide/guards.md#命令冷却)。
