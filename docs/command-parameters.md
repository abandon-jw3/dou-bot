# 命令参数与最终使用方式

文字参数部分适用于已发布的 dou-bot 0.6.0；后面的附件与身份装饰器属于公开契约 1.9 的未发布源码 API。它们不增加运行时依赖，群聊、私聊与两种接入方式共用同一套规则。

## 可运行示例

以下 npm 脚本在公开的框架源码仓库目录执行，源码链接可直接访问。独立应用可直接使用下面的公开 API 代码。

```sh
npm run example:query
```

[examples/query.ts](https://github.com/abandon-jw3/dou-bot/blob/main/examples/query.ts) 使用测试入口运行真实装饰器、参数解析和消息编码，不读取 `.env`，不发真实 QQ 消息。示例返回解析结果；业务查询服务由应用自行接入。

业务使用方式：

```ts
import { BotFactory, Command, Controller, HelpModule, Module, Option, Rest, Slot } from 'dou-bot';

const cities = new Set(['北京', '上海', '深圳']);

@Controller()
class QueryController {
  @Command('查询', { aliases: ['查'], description: '查询城市信息' })
  query(
    @Slot('city', {
      name: '城市',
      required: true,
      match: (text) => cities.has(text),
    })
    city: string,

    @Slot('topic', {
      name: '查询类型',
      required: true,
      choices: ['天气', '空气质量'],
    })
    topic: string,

    @Rest({ name: '补充内容' }) remaining: string[],

    @Option('page', {
      alias: 'p',
      name: '页码',
      type: 'integer',
      min: 1,
      default: 1,
    })
    page: number,

    @Option('detail', {
      alias: 'd',
      name: '详细模式',
      type: 'boolean',
      default: false,
    })
    detail: boolean,
  ): string {
    return `${city} ${topic}；补充=${JSON.stringify(remaining)}；页码=${page}；详细=${detail}`;
  }
}

@Module({ imports: [HelpModule], controllers: [QueryController] })
class AppModule {}

const app = await BotFactory.create(AppModule, {
  appId: process.env.QQ_APP_ID!,
  secret: process.env.QQ_APP_SECRET!,
  transport: { type: 'ws' },
  commands: { prefix: '', invalidInput: 'reply' },
});
await app.start();
// 宿主收到退出信号时调用并等待 app.close()。
```

| 用户消息                               | 城市 / 类型     | remaining                | 选项                               |
| -------------------------------------- | --------------- | ------------------------ | ---------------------------------- |
| `查询 北京 天气`                       | 北京 / 天气     | `[]`                     | page=1, detail=false               |
| `查询 天气 北京`                       | 北京 / 天气     | `[]`                     | 同上                               |
| `查询 今天 天气 北京 详细`             | 北京 / 天气     | `['今天', '详细']`       | 同上；普通词“详细”不会隐式设置选项 |
| `查 北京 空气质量 "未来 三天" -p 2 -d` | 北京 / 空气质量 | `['未来 三天']`          | page=2, detail=true                |
| `查询 北京 上海 天气`                  | 不执行业务      | 城市重复，报输入错误     | Rest 不接收多余城市                |
| `查询 北京 今天`                       | 不执行业务      | 缺少查询类型，报输入错误 | Rest 不掩盖缺参                    |

`Slot` 依靠业务字典、枚举或同步匹配器识别单个分词，不进行中文分词、自然语言推理或模糊猜测。包含空格的一个参数需要引号，例如 `"未来 三天"`。

## 参数 API

| API                       | 注入值                         | 功能                                                |
| ------------------------- | ------------------------------ | --------------------------------------------------- |
| `@Arg(index)`             | `string \| undefined`          | 保持旧位置参数行为，index 从 0 开始                 |
| `@Arg(index, options)`    | 对应类型的标量，或 `undefined` | 显式转换、必填、默认值、范围与枚举                  |
| `@Option(name, options?)` | 对应类型的标量，或 `undefined` | 提取长选项及单字母短别名                            |
| `@Slot(name, options)`    | `string \| undefined`          | 以 choices / match 识别任意位置的分词               |
| `@Rest(options?)`         | `string[]`                     | 收集尚未消费的普通分词；空时为 `[]`                 |
| `@Args()`                 | `string[]`                     | 完整分词快照，包含选项名、选项值和 `--`，不参与消费 |
| `@Ctx()`                  | `MessageContext`               | 当前消息上下文                                      |

`ArgumentOptions` 及 `OptionOptions`：

| 字段          | 默认 / 约束                                                            |
| ------------- | ---------------------------------------------------------------------- |
| `name`        | 帮助和错误提示中的显示名；默认位置参数序号或长选项名                   |
| `description` | 可选说明，用于帮助                                                     |
| `type`        | 默认 `string`；支持 `string / integer / number / boolean`              |
| `required`    | 默认 false；只检查是否提供，显式空字符串算已提供                       |
| `default`     | 缺省时注入；必须符合 type、choices、min/max；不能与 required=true 同用 |
| `choices`     | 非空、无重复的字符串或数字数组，与 type 一致；boolean 不支持 choices   |
| `min / max`   | 仅数字类型，包含边界；integer 的边界也必须是安全整数                   |
| `alias`       | 仅 Option：单个 ASCII 字母，如 `p`，对应 `-p`                          |

不根据 TypeScript 的 `: number` 自动转换，必须明确声明 `type: 'integer'` 或 `'number'`。integer 只接收十进制整数文本，且结果必须是 JS 安全整数；number 接收有限十进制数（支持科学计数法），拒绝十六进制、NaN、Infinity、空字符串。boolean 只接收小写 `true / false`。

`SlotOptions` 有 name、description、required、default，以及至少一个 `choices: readonly string[]` 或 `match: (text: string) => boolean`。两者同时提供时取交集。匹配器必须是纯函数、同步返回布尔值；每个分词可能交给多个匹配器。带 default 时也会在启动校验中调用匹配器。引用的业务字典由应用管理，框架仅冻结声明及复制 choices 数组，不复制闭包状态。

`RestOptions` 仅提供 name、description。每个命令最多一个 Rest。它是普通数组参数，例如 `@Rest() remaining: string[]`；不要写成 JS 可变参数 `...remaining`。Args 也遵守这个规则。

## 解析与消费顺序

1. 按原有规则识别命令名、引号、转义和分词；保留空引号内容与被转义的空白。
2. 提取声明的 Option 及其值，得到普通参数列表。
3. Arg 按普通参数列表的固定下标绑定，消费相应位置；因此选项本身不占 Arg 下标。
4. 每个未消费分词匹配全部 Slot：只命中一个才可绑定，命中多个即歧义；一个 Slot 收到多个分词也报错，不按声明顺序抢占。
5. 检查缺失 Slot；将尚未消费分词按原顺序注入 Rest。

不论 Rest 在方法参数列表中排第几个，都在最后收集。Slot 只在未被 Option/Arg 消费的分词中匹配。没有 Rest 时，多余普通分词会被拒绝；有 Args 不会改变这一点。

新增 Option、Slot、Rest 或 `Arg(index, options)` 任意一项就启用上述严格规则。只使用旧 `Arg(index)` / Args / Ctx 的命令保持旧模式：选项形状的文本仍是位置参数，多余参数不自动报错，缺参注入 undefined，支持 JS 默认参数。为旧命令添加新声明时，应显式决定是否需要 Rest。

## 选项语法

```text
查询 北京 天气 --page 2
查询 --page=2 天气 北京
查询 北京 -p 2 天气 -d
查询 北京 天气 -p=2 --detail=false
```

长名称以 ASCII 字母起头，后续可用字母、数字、下划线、连字符，大小写敏感。短别名是一个 ASCII 字母；不支持 `-dp2` 之类的合并短选项。重复指定同一个选项（含混用长短别名）会报错。

布尔开关 `--detail` / `-d` 等同 true；指定 false 使用 `--detail=false` / `-d=false`。布尔开关不消费后一个分词，`--detail false` 中的 `false` 是普通参数。没有声明 default 的可选参数一律缺省为 undefined，包括 boolean。`--no-detail` 不会自动生成。

未知的 `--name`、`-x` 会报错，不能由 Rest 偷偷接收。需要把选项形状的内容作为文本时，用引号、开头转义或 `--`：

```text
查询 北京 天气 "--note"
查询 北京 天气 \-x
查询 北京 天气 -- --note -x
```

`--` 自身不进入 Rest，但之后的全部分词按普通参数处理，仍可命中 Slot。以引号或转义开头的分词不会作为选项标记。数字负值可以写为 `--offset -3` 或 `--offset=-3`；以 `--` / 字母短选项形状开头的字符串值需引号或使用等号形式。

## 帮助与输入错误

在模块 imports 中加入 `HelpModule` 后，注册 `help` 及别名 `帮助`；不导入就不注册。两者遵守当前应用前缀。`help` 列出命令，`help 查询` 或 `help 查` 显示同一命令的用法、别名、说明、Slot/Rest 和选项规则。命令名参数不带前缀。重复导入沿用模块去重；已有同名 help/帮助 路由会在启动时报冲突。

`commands.invalidInput` 默认 `'report'`：错误进入 logger / onError；设为 `'reply'` 时，分词错误、缺参、歧义、重复值、非法选项或类型/范围错误会额外回复简短提示和用法。业务处理器不执行。错误仍记为失败事件，便于统计。

只有框架解析阶段产生的输入错误可自动回复；自定义匹配器抛错、返回 Promise/非布尔值、业务异常及接口错误仅上报。回复通过原有发送跟踪和回复序号机制；重复平台投递不会重复回复。任务已取消时不追加输入错误回复。

声明错误（重复 Slot 名、多个 Rest、重复 Option 名/别名、重复位置消费、默认值不合法等）在应用初始化时拒绝，先于实例构造和网络连接。完整类型由 `dou-bot` 包入口提供；源码验证覆盖见 [验证记录](https://github.com/abandon-jw3/dou-bot/blob/main/docs/validation-report.md)。

## 附件参数（未发布源码 API）

以下五个装饰器和 `AttachmentOptions` 尚未发布到 npm，不能从已发布的 0.6.0 导入。源码示例使用 `npm run example:attachments`，实际安装包消费者由 `npm run test:package` 校验；独立业务示例、文档站和技能继续验证 npm 0.6.0。

每个装饰器接受可选的 `AttachmentOptions`，为命令处理器注入 `readonly Attachment[]`：

| 装饰器           | 选择范围                                                                           |
| ---------------- | ---------------------------------------------------------------------------------- |
| `@Attachments()` | 当前消息的全部顶层附件，包含类型缺失或未知的附件                                   |
| `@Images()`      | `image/*`                                                                          |
| `@Videos()`      | `video/*`                                                                          |
| `@Audios()`      | QQ 的 `voice` 标记及 `audio/*`                                                     |
| `@Files()`       | QQ 的 `file` 标记，以及非 image/video/audio 的合法 MIME 类型，如 PDF、压缩包、文本 |

匹配时修剪空白、忽略大小写并去除分号后的 MIME 参数；保留 `contentType` 和 `raw` 的原始值。缺失或无法识别的裸类型、不完整 MIME、`image/*` 这类范围值只进入 Attachments；不根据 URL 或文件名后缀推断类型。

```ts
import { Command, Controller, Images, Rest } from 'dou-bot';
import type { Attachment } from 'dou-bot';

@Controller()
class PictureCommands {
  @Command('测试图片')
  receive(
    @Images({ name: '图片', minCount: 1, maxCount: 4 }) images: readonly Attachment[],
    @Rest({ name: '备注' }) notes: string[],
  ): string {
    return `收到 ${images.length} 张图片；备注：${notes.join(' ') || '无'}。`;
  }
}
```

将控制器注册到模块后，在同一条消息中发送 `/测试图片 备注` 并附图。使用空前缀时可直接发送 `测试图片 备注`。装饰器只注入元信息；下载、保存、转码或识别放在业务服务中处理。单独发送图片不会自动匹配命令，分条补图仍使用 `ctx.prompt()`。

`AttachmentOptions` 的字段为 `name`、`description`、`minCount`、`maxCount`。默认最少 0 个、最多无上限，没有匹配项时注入 `[]`。数量只统计筛选后的集合；上限 0 可用于拒绝某类附件。上下限必须是非负安全整数，且 maxCount 不得小于 minCount；未知选项、非法名称或上下限在启动时以 CONFIG 拒绝。不提供额外的 required、default 或单附件装饰器。

附件数组是每次绑定创建的浅冻结副本，保留原顺序和重复项；附件对象及 raw 延续现有只读约定。多个装饰器可选中同一个附件，互不消费，也不占 Arg 的文字位置。添加附件装饰器不会把旧 Arg/Args/Ctx 命令切换为严格文字解析。

执行顺序为 Guard → 原有文字参数绑定 → 附件选择与数量校验 → 身份注入（如有） → 冷却 → 处理器。数量不满足时产生 PARAMETER_PARSE，按 `commands.invalidInput` 的 report/reply 配置处理，不占用冷却；帮助信息同时展示附件类型、名称、说明和数量要求。附件装饰器只支持 Command 参数，构造参数、原始 On 和 OnButton 不支持。

框架只读取本条消息顶层的 attachments；不会递归合并 msg_elements 中的引用/聊天记录，也不从 ARK 预览图合成附件。Attachment 增加可选的 `voiceWavUrl` 与 `asrReferText`，对应 QQ 的 voice_wav_url、asr_refer_text；它们不会替换消息 content 或触发语音命令。其余附件字段和 URL 的校验方式保持原状。

协议依据：[QQ 单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html)、[QQ 群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)。文档描述、离线夹具与具体账号实测分别记录，不把支持筛选视频/音频当作所有账号都已验证对应投递能力。

## 身份参数（未发布源码 API）

以下五个无参数装饰器及 UserInfo / GroupInfo 属于公开契约 1.9，尚未发布到 npm，不能从 0.6.0 导入。可在源码仓库运行 `npm run example:identity`；独立消费者验证当前 tarball，业务示例、网站和技能继续使用 npm 0.6.0 的 `@Ctx()`。

| 装饰器       | 注入类型                 | 含义                                           |
| ------------ | ------------------------ | ---------------------------------------------- |
| `@User()`    | `UserInfo`               | 当前消息发送者或按钮操作者的身份快照           |
| `@UserId()`  | `string`                 | 当前用户的归一化 OpenID，与 ctx.userId 一致    |
| `@Group()`   | `GroupInfo \| undefined` | 当前群的身份快照；私聊为 undefined             |
| `@GroupId()` | `string \| undefined`    | 当前群 OpenID；私聊为 undefined                |
| `@Role()`    | `GroupRole \| undefined` | 当前群消息作者角色；私聊、按钮及未知角色均缺失 |

```ts
export interface UserInfo {
  readonly id: string;
  readonly username?: string;
  readonly bot?: boolean;
  readonly memberRole?: GroupRole;
}

export interface GroupInfo {
  readonly id: string;
}
```

GroupRole 复用 `'member' | 'admin' | 'owner'`。用户名、机器人标记只读取当前消息顶层 author 的对应字段，类型正确才提供，空昵称与 `bot: false` 原样保留。GroupInfo 首版只有 id，不包含群名、头像或成员列表；其他平台原始字段仍从 `@Ctx().raw` 读取。

```ts
import { Command, Controller, Ctx, Group, GroupId, OnButton, Role, User, UserId } from 'dou-bot';
import type { ButtonContext, GroupInfo, GroupRole, UserInfo } from 'dou-bot';

@Controller()
class IdentityCommands {
  @Command('我')
  me(
    @User() user: UserInfo,
    @Group() group: GroupInfo | undefined,
    @Role() role: GroupRole | undefined,
  ): string {
    return `用户：${user.username || user.id}；群：${group?.id ?? '私聊'}；角色：${role ?? '未知或不适用'}。`;
  }

  @OnButton('who')
  async who(
    @UserId() userId: string,
    @GroupId() groupId: string | undefined,
    @Ctx() ctx: ButtonContext,
  ): Promise<void> {
    await ctx.ack();
    await ctx.send(`操作者：${userId}；群：${groupId ?? '私聊'}。`);
  }
}
```

将控制器注册到模块即可使用。按钮事件只提供 UserInfo.id 以及适用的 GroupInfo.id，其余用户资料与角色缺失；不会从上一条消息、管理者按钮权限、提及或引用消息推断。群和用户 ID 是当前场景的 OpenID，不是显示用群号或 QQ 号；不要假设同一人的群聊与私聊 OpenID 相同。

快照在事件归一化时创建并冻结，同一事件可以共享，不同事件独立；原始 On 观察器修改 raw 不会改变快照。装饰器只同步注入本条事件信息，不请求完整资料，不缓存角色，不消费任何文字或附件，不触发严格文字模式，也不出现在帮助的输入参数中。现有 Context 接口不变。

命令执行顺序为 Guard → 文字参数绑定 → 附件校验 → 身份注入 → 冷却 → 处理器；按钮为 Guard → 身份注入 → 冷却 → 处理器，原有交互确认行为保持。缺失群信息或角色时正常注入 undefined，不产生输入错误；需要限制群聊或角色时，继续使用 [GroupOnly / GroupRoles 等访问限制](access-control.md)。角色注入本身不执行权限检查，装饰器也不支持 required、默认值或字段选择配置。

身份装饰器只用于 Command / OnButton 参数。构造器、静态方法、原始 On 或未注册的方法会按 CONFIG 机制拒绝；同一参数只能声明一种来源。继承方法保留参数声明，覆写方法必须按原有规则重新注册。
