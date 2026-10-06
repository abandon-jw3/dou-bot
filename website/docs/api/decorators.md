# 装饰器参考

所有装饰器都从 `dou-bot` 导入。先按你要完成的任务选择，再查看参数、使用位置和示例。

| 你要做什么               | 使用哪些装饰器                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 组织业务并注入服务       | [Module](#module)、[Controller](#controller)、[Injectable](#injectable)、[Inject](#inject)                                                        |
| 接收命令、事件或按钮点击 | [Command](#command)、[On](#on)、[OnButton](#onbutton)                                                                                             |
| 读取上下文和文字参数     | [Ctx](#ctx)、[Arg](#arg)、[Args](#args)、[Option](#option)、[Slot](#slot)、[Rest](#rest)                                                          |
| 限制场景、用户和角色     | [GroupOnly](#grouponly)、[PrivateOnly](#privateonly)、[UsersOnly](#usersonly)、[GroupRoles](#grouproles)、[GroupManagersOnly](#groupmanagersonly) |
| 自定义权限或限制调用频率 | [UseGuards](#useguards)、[Cooldown](#cooldown)                                                                                                    |

下方示例展示装饰器的声明方式；可以直接运行的完整模块见 [示例](../examples/hello.md)。

## Module {#module}

声明模块的依赖、服务、控制器和导出。

```ts
Module(metadata: ModuleMetadata): ClassDecorator
```

**参数与默认值：** metadata 可包含 imports、providers、controllers、exports、guards；省略数组表示不注册对应项。

**用在哪里：** 模块类。

```ts
@Module({ controllers: [HelloController] })
```

**使用限制：** 模块类本身不被自动实例化。模块 guards 只保护直接注册的控制器。

[教程与完整示例](../guide/modules.md)。

## Injectable {#injectable}

标记需要构造注入元数据的服务或 Guard。

```ts
Injectable(): ClassDecorator
```

**参数与默认值：** 无参数；还需要在模块 providers 中注册。

**用在哪里：** 需要注入的服务类或 Guard 类。

```ts
@Injectable()
```

**使用限制：** 默认是单例；请求状态不应存入共享实例字段。

[教程与完整示例](../guide/modules.md)。

## Inject {#inject}

为构造函数参数显式指定运行时令牌。

```ts
Inject(token: InjectionToken): ParameterDecorator
```

**参数与默认值：** token 为类、字符串或 Symbol。接口配置通常使用 Symbol。

**用在哪里：** 构造函数参数。

```ts
constructor(@Inject(SETTINGS) private readonly settings: Settings) {}
```

**使用限制：** 接口在运行时被擦除；单写类型注解不能注册接口依赖。

[教程与完整示例](../guide/modules.md)。

## Controller {#controller}

标记命令、按钮或事件处理器所在的类。

```ts
Controller(): ClassDecorator
```

**参数与默认值：** 无参数；模块 controllers 决定是否注册。

**用在哪里：** 控制器类。

```ts
@Controller()
```

**使用限制：** Controller 不作为跨模块注入或导出的 Provider。

[教程与完整示例](../guide/commands.md)。

## Command {#command}

注册一个命令处理器。

```ts
Command(name: string, options?: CommandOptions): MethodDecorator
```

**参数与默认值：** name 不带前缀；options 提供 aliases 和 description，默认无别名和说明。

**用在哪里：** 控制器的命令方法。

```ts
@Command('hello', { aliases: ['hi'], description: '问好' })
```

**使用限制：** 返回字符串或 MessageInput 自动回复；手动 reply 后返回 void。名称和别名冲突会导致创建失败。

[教程与完整示例](../guide/commands.md)。

## On {#on}

按精确 QQ 事件名注册原始事件观察器。

```ts
On(eventName: string): MethodDecorator
```

**参数与默认值：** eventName 必填，例如 C2C_MESSAGE_CREATE。

**用在哪里：** 控制器的原始事件处理方法。

```ts
@On('C2C_MESSAGE_CREATE')
```

**使用限制：** 处理器返回 void；不受模块/类 Guard 保护，不能在 On 方法上叠加 Guard 或 Cooldown。

[教程与完整示例](../guide/events.md)。

## OnButton {#onbutton}

按 callback 按钮 ID 处理点击。

```ts
OnButton(buttonId: string): MethodDecorator
```

**参数与默认值：** buttonId 与 button.callback 的第一个参数一致。

**用在哪里：** 控制器的按钮回调方法。

```ts
@OnButton('docs:confirm')
```

**使用限制：** 只处理回调按钮，不处理 link/command 按钮；返回 void，发送使用 ButtonContext.send。

[教程与完整示例](../guide/buttons.md)。

## Ctx {#ctx}

注入当前路由的上下文。

```ts
Ctx(): ParameterDecorator
```

**参数与默认值：** 无参数；命令为 MessageContext，按钮为 ButtonContext，On 为 QQEventContext。

**用在哪里：** Command、On 或 OnButton 方法的参数；参数类型与对应上下文一致。

```ts
handler(@Ctx() ctx: MessageContext) {}
```

**使用限制：** 不能将一种上下文的能力假定存在于另一种上下文，例如按钮没有 prompt。

[教程与完整示例](./contexts.md)。

## Arg {#arg}

绑定命令的一个位置参数。

```ts
Arg(index: number, options?: ArgumentOptions): ParameterDecorator
```

**参数与默认值：** index 从 0 开始。无 options 时注入 string 或 undefined；options 显式声明 type、required、default、choices、min/max 等。

**用在哪里：** 命令方法的参数。

```ts
name(@Arg(0) value = '朋友') {}
```

**使用限制：** TypeScript 的 number 注解不会自动转换。default 不能与 required: true 同用。

[教程与完整示例](../guide/parameters.md)。

## Args {#args}

取得命令后全部分词的数组快照。

```ts
Args(): ParameterDecorator
```

**参数与默认值：** 无参数；包含选项名、选项值和 --，不含命令名。

**用在哪里：** 命令方法的参数。

```ts
echo(@Args() words: string[]) {}
```

**使用限制：** 不参与消费，也不代替 Rest。使用普通数组参数，不使用 ...words 可变参数语法。

[教程与完整示例](../guide/parameters.md)。

## Option {#option}

绑定长选项和可选的单字母短别名。

```ts
Option(name: string, options?: OptionOptions): ParameterDecorator
```

**参数与默认值：** 默认 type 为 string、required 为 false。alias 为单个 ASCII 字母；其他字段与 ArgumentOptions 对应。

**用在哪里：** 命令方法的参数。

```ts
query(@Option('page', { alias: 'p', type: 'integer', default: 1 }) page: number) {}
```

**使用限制：** 不支持合并短选项；重复或未知选项会被拒绝。布尔 false 写成 --flag=false。

[教程与完整示例](../guide/parameters.md)。

## Slot {#slot}

识别任意位置的单个普通分词。

```ts
Slot(name: string, options: SlotOptions): ParameterDecorator
```

**参数与默认值：** name 在同一命令中唯一；options 至少提供 choices 或 match，两者同时提供取交集。required 默认 false。

**用在哪里：** 命令方法的参数。

```ts
query(@Slot('city', { choices: ['北京'], required: true }) city: string) {}
```

**使用限制：** match 必须同步且无副作用；重复值或多 Slot 歧义报错，不按声明顺序抢占。

[教程与完整示例](../guide/parameters.md)。

## Rest {#rest}

收集未被 Arg、Slot 或 Option 消费的普通分词。

```ts
Rest(options?: RestOptions): ParameterDecorator
```

**参数与默认值：** options 仅 name、description；没有剩余时注入空数组。

**用在哪里：** 命令方法的参数。

```ts
query(@Rest() notes: string[]) {}
```

**使用限制：** 每个命令最多一个，始终最后消费；不能掩盖必填、歧义或选项错误。

[教程与完整示例](../guide/parameters.md)。

## UseGuards {#useguards}

给模块、控制器或方法追加权限检查。

```ts
UseGuards(...tokens: InjectionToken<CanActivate>[]): ClassDecorator & MethodDecorator
```

**参数与默认值：** 传一个或多个 Provider 令牌，按声明顺序运行；Guard 需在所属模块可见。

**用在哪里：** 模块类、控制器类，以及 Command 或 OnButton 方法。

```ts
@UseGuards(AllowlistGuard, OwnerGuard)
```

**使用限制：** 传令牌而不是 new Guard()。不同层级累加，重复声明不会自动去重。

[教程与完整示例](../guide/guards.md)。

## GroupOnly {#grouponly}

只允许群聊命令或群聊按钮。

```ts
GroupOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

**参数与默认值：** message 省略时使用默认拒绝提示，false 静默拒绝，非空字符串自定义提示。

**用在哪里：** 模块类、控制器类，以及 Command 或 OnButton 方法。

```ts
@GroupOnly()
```

**使用限制：** 无需额外 Provider。可用于模块类；与 PrivateOnly 的冲突在创建时拒绝。

[教程与完整示例](../guide/access.md)。

## PrivateOnly {#privateonly}

只允许私聊命令或私聊按钮。

```ts
PrivateOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

**参数与默认值：** message 与 GroupOnly 相同。

**用在哪里：** 模块类、控制器类，以及 Command 或 OnButton 方法。

```ts
@PrivateOnly()
```

**使用限制：** 模块级规则只覆盖本模块控制器，不传播到 imports。

[教程与完整示例](../guide/access.md)。

## UsersOnly {#usersonly}

按当前事件的 OpenID 限制调用者。

```ts
UsersOnly(userIds: readonly string[], options?: UsersOnlyOptions): ClassDecorator & MethodDecorator
```

**参数与默认值：** userIds 为非空字符串数组；可指定 scene、groupId、message。groupId 隐含群聊。

**用在哪里：** 模块类、控制器类，以及 Command 或 OnButton 方法。

```ts
@UsersOnly(['USER_OPENID'], { scene: 'private' })
```

**使用限制：** OpenID 不是数字 QQ 号，群聊与私聊身份不应混用。groupId 不能配 private。

[教程与完整示例](../guide/access.md)。

## GroupRoles {#grouproles}

只允许当前群消息发送者的指定角色。

```ts
GroupRoles(...roles: GroupRole[]): ClassDecorator & MethodDecorator
```

**参数与默认值：** 至少一个 member、admin 或 owner；允许任一列出的角色。使用默认拒绝提示。

**用在哪里：** 模块类、控制器类或 Command 方法；不能把角色规则施加到 OnButton。

```ts
@GroupRoles('owner')
```

**使用限制：** 只支持命令，不能用于 OnButton；缺失或未知角色拒绝，不推测身份。

[教程与完整示例](../guide/access.md)。

## GroupManagersOnly {#groupmanagersonly}

允许当前群主或管理员。

```ts
GroupManagersOnly(options?: AccessOptions): ClassDecorator & MethodDecorator
```

**参数与默认值：** 相当于角色 owner 或 admin；message 可自定义或设为 false。

**用在哪里：** 模块类、控制器类或 Command 方法；不能把角色规则施加到 OnButton。

```ts
@GroupManagersOnly({ message: '仅限群管理者。' })
```

**使用限制：** 只支持命令。按钮点击资格使用原生 permission: managers，而不是本装饰器。

[教程与完整示例](../guide/access.md)。

## Cooldown {#cooldown}

限制命令或按钮处理器的调用频率。

```ts
Cooldown(options: CooldownOptions): MethodDecorator
```

**参数与默认值：** scope 为 user、session 或 command；durationMs 为正整数。message 默认显示剩余时间，可设为字符串或 false。

**用在哪里：** Command 或 OnButton 方法。

```ts
@Cooldown({ scope: 'user', durationMs: 3000 })
```

**使用限制：** 每个方法最多一个；在 Guard 和参数通过后占用，业务失败不返还。user 表示同会话同用户。

[教程与完整示例](../guide/guards.md)。
