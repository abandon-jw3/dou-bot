# 命令参数与最终使用方式

本文适用于 dou-bot 0.7.0 / 公开契约 1.11。它们不增加运行时依赖，群聊、私聊与两种接入方式共用同一套规则。

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

## 附件参数

Attachments、Images、selectAttachments 及相关类型从 0.7.0 开始提供。独立应用从 dou-bot 导入，源码仓库可运行 `npm run example:attachments`。

需要随命令附图时，在同一条消息中发送文字和图片。视频、音频和文件采用两步操作：先发送命令，收到机器人的提示后，再单独发送附件。机器人只能处理 QQ 实际投递的事件，群聊中的独立附件是否送达取决于账号权限。

### 同条消息的附件

| 装饰器                   | 注入值                  | 用途                                                 |
| ------------------------ | ----------------------- | ---------------------------------------------------- |
| `@Attachments(options?)` | `readonly Attachment[]` | 当前命令消息的全部顶层附件，包含类型缺失或未知的附件 |
| `@Images(options?)`      | `readonly Attachment[]` | 当前命令消息中标为 image MIME 的图片                 |

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

注册控制器后，在同一条消息中发送 `/测试图片 备注` 并附图。使用空前缀时直接发送 `测试图片 备注`。单独发送附件不会自动触发这条命令。

`AttachmentOptions` 提供 name、description、minCount、maxCount。默认最少 0 个、最多无上限，没有匹配项时注入空数组；数量只统计筛选结果。上限 0 可用于拒绝附件。上下限必须是非负安全整数，且 maxCount 不得小于 minCount；非法配置在启动时以 CONFIG 拒绝。

同条附件装饰器不消费文字，不改变旧式或严格文字模式，支持 Command 参数，也可用于下文的 OnAttachment 匹配集合。命令执行顺序保持 Guard → 文字绑定 → 附件数量校验 → 身份注入 → 冷却 → 处理器。数量不足或过多仍产生 PARAMETER_PARSE，遵循 commands.invalidInput，不占用冷却；帮助会说明类型、名称、描述及数量要求。

### 分条接收视频、音频或文件

保留明确的提问步骤，再对收到的消息调用同步工具函数：

```ts
import { Command, Controller, Ctx, selectAttachments } from 'dou-bot';
import type { MessageContext } from 'dou-bot';

@Controller()
class FileCommands {
  @Command('处理文件')
  async receive(@Ctx() ctx: MessageContext): Promise<void> {
    const answer = await ctx.prompt('请单独发送 1 个文件，或发送“取消”。');
    if (answer.status !== 'received') {
      await ctx.reply(answer.status === 'timeout' ? '等待超时。' : '已取消。');
      return;
    }
    const result = selectAttachments(answer.message.attachments, {
      kind: 'file',
      minCount: 1,
      maxCount: 1,
    });
    if (result.status === 'invalid') {
      await answer.message.reply(`请发送 1 个文件，本条匹配 ${result.count} 个。`);
      return;
    }
    // 将 result.attachments 交给业务服务处理。
    await answer.message.reply(`收到 ${result.attachments.length} 个文件。`);
  }
}
```

接收视频或音频时，将 kind 改为 video 或 audio，同时调整提问与提示。示例一次只接收下一条消息，校验失败后结束；再次提问、批量收集、保存和处理附件由业务明确编写。使用新消息的上下文回复，才能引用刚收到的附件消息。

prompt 的超时、取消、同用户和同会话隔离保持原样。进入处理器时原命令已经通过 Guard 并占用冷却；后续输入不会重新执行 Guard，也不会因附件校验失败自动退还冷却。涉及管理操作时，应依据新输入复核权限；详细规则见 [二次输入指南](prompts.md)。

### selectAttachments

```ts
selectAttachments(
  attachments: readonly Attachment[],
  options?: AttachmentSelectionOptions,
): AttachmentSelectionResult
```

函数接收规范化的 Attachment 数组，例如 ctx.attachments 或 answer.message.attachments，不解析 QQ 原始 payload。它同步执行筛选和数量判定，不等待、不下载、不发送提示，也不读取消息历史。

| kind        | 筛选范围                                                             |
| ----------- | -------------------------------------------------------------------- |
| all（默认） | 全部附件，包括未知或缺失类型                                         |
| image       | image MIME                                                           |
| video       | video MIME                                                           |
| audio       | QQ 的 voice 标记及 audio MIME                                        |
| file        | QQ 的 file 标记，以及其他合法 MIME，例如 application/pdf、text/plain |

MIME 匹配修剪空白、忽略大小写并移除分号后的类型参数，只接受具体的 type/subtype；裸类型、残缺 MIME 和 image/* 这种范围值只进入 all。不根据文件名或 URL 扩展名猜测类型；音频文件若被 QQ 标为 file，也按 file 选择。

AttachmentSelectionOptions 的字段是 kind、minCount、maxCount，默认分别为 all、0、无上限。类型筛选完成后才检查数量；例如要求一个视频而收到图片时，匹配数量为 0。需要必填附件时显式设置 minCount: 1。

| 结果    | 字段                 | 业务处理                                         |
| ------- | -------------------- | ------------------------------------------------ |
| valid   | attachments          | 使用筛选后的数组                                 |
| invalid | reason、count、limit | 根据失败原因、实际数量和触发的边界决定提示或结束 |

reason 为 too-few 或 too-many。普通校验失败不会抛异常、调用 onError 或触发 commands.invalidInput；失败结果不携带部分附件，也不会为满足上限而截断数组。选项拼写、未知 kind、非法上下限或非规范化数组属于调用错误，以 HANDLER_CONTRACT 抛出。

结果对象冻结；成功数组是浅冻结副本，保留原顺序、重复项和附件对象引用。附件对象及 raw 延续现有只读约定，contentType 原值不会被改写。多个选择操作相互独立，原数组保持不变。

只选择明确传入的数组，不递归读取 raw、msg_elements 或 ARK 预览图。语音元信息 voiceWavUrl / asrReferText 继续保留，但不会替换消息正文或触发命令。

### 从早期未发布源码迁移

Videos、Audios、Files 已移除。将相应命令改为 `@Ctx()` 加 `ctx.prompt()`，再使用 selectAttachments；没有字段选择器或自动等待的参数选项。Attachments、Images 与既有 AttachmentOptions 保持原来的同条消息语义，身份装饰器不受影响。

协议字段参考：[QQ 单聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/c2c_message_create.html)、[QQ 群聊消息](https://bot.q.qq.com/wiki/develop/api-v2/autogen/event/group_message_create.html)。合成的混合附件输入只用于协议健壮性测试，不作为客户端组合发送能力的证明。

## 身份参数

以下五个无参数装饰器及 UserInfo / GroupInfo 从 dou-bot 0.7.0 开始提供，不能从 0.6.0 导入。可在源码仓库运行 `npm run example:identity`；独立应用从包含这些 API 的 SDK 版本导入。

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

身份装饰器用于 Command / OnButton / OnAttachment 参数。构造器、静态方法、原始 On 或未注册的方法会按 CONFIG 机制拒绝；同一参数只能声明一种来源。继承方法保留参数声明，覆写方法必须按原有规则重新注册。

## 自动处理上传附件

用户直接发送文件时，使用 `@OnAttachment()` 声明处理器。例如接收名为“报告_日期.docx”的文件：

```ts
import { Attachments, Controller, OnAttachment } from 'dou-bot';
import type { Attachment } from 'dou-bot';

@Controller()
export class ReportsController {
  @OnAttachment({
    filename: /^报告_\d{8}\.docx$/u,
    extension: 'docx',
    invalidInput: 'reply',
  })
  accept(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
    // 在这里交给应用自己的下载与文档处理服务。
    return `已接收 ${files.length} 个匹配文件。`;
  }
}
```

将控制器注册到模块。此 API 从 **0.7.0 / 契约 1.11** 开始提供，npm 0.6.0 无法运行该示例。

`OnAttachmentOptions` 的筛选条件可省略：

| 选项           | 行为                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `filename`     | 字符串精确匹配完整文件名，区分大小写；RegExp 按表达式和 flags 匹配。需要完整匹配时写 `^` / `$`。                          |
| `extension`    | 一个字面扩展名，例如 `docx` 或 `.docx`，忽略大小写；按文件名最后扩展名匹配。空值、空白、路径、通配符与复合后缀为 CONFIG。 |
| `kind`         | 默认 `all`，也可为 `image`、`video`、`audio`、`file`，使用上文的 MIME 与 QQ 标记分类规则。                                |
| `invalidInput` | 默认 `report`；设为 `reply` 时，附件参数的数量错误额外回复提示。                                                          |

所有提供的条件必须同时命中同一个附件。没有文件名时，filename 和 extension 均无法匹配；不从 URL 推断文件名，不从扩展名推断 MIME。省略所有条件时，接收任何包含顶层附件的消息，纯文字消息不触发。正则保存独立快照，`g` / `y` 状态不会在附件之间延续。

每条消息对每个匹配处理器调用一次。`@Attachments()` 获得该处理器匹配的集合；`@Images()` 在这个集合中进一步选择图片。顺序与重复项保留，各参数是独立的浅冻结数组；`ctx.attachments` 仍包含原消息的全部附件。数量限制针对参数自己的筛选结果；Guard 先执行，随后数量校验、身份注入、冷却、处理器。数量错误使用 PARAMETER_PARSE，不占用冷却；普通路由未命中保持静默。`commands.invalidInput` 不控制附件路由的提示，也不会添加命令用法。

附件处理器支持 `Ctx`、`Attachments`、`Images` 和五种身份装饰器，可使用模块、控制器、方法级 Guard、GroupOnly、UsersOnly、GroupRoles 和 Cooldown；文字参数装饰器不适用。返回消息会自动回复；调用 reply 或带问题的 prompt 后返回 void，send 沿用现有规则。原始 On 和按钮的参数限制仍按各自声明检查。同一方法只能注册一种路由，附件处理器不进入命令帮助。

正在等待的 prompt 优先接收下一条消息；已识别的命令优先处理本条消息，即使命令被拒绝、冷却或执行出错也不会转交附件处理器。其余消息交给所有匹配的附件处理器，包括不带条件的处理器；不存在最具体匹配或兜底优先级。未识别的命令文字可以随附件进入此流程。原始 On 继续在正常业务分发前观察事件，被 prompt 接收的消息则由该会话独占。

多个匹配处理器按现有发现顺序运行：导入模块先于导入方，控制器按模块注册顺序，同一控制器内按方法名排序。某个处理器被 Guard 拒绝、进入冷却、参数错误或执行失败后，继续其他处理器；各自独立检查权限和冷却。应用取消或关闭中止后续执行。

需要询问处理方式时，可以在附件处理器里 `await ctx.prompt('请选择处理方式')`。后续处理器等本次追问结束后运行，并继续处理原始上传消息；追问答案不会广播给它们。超时和取消沿用 [二次输入指南](prompts.md)。框架在每个处理器结束时收尾已登记的发送，取消并报告未等待的 prompt，使该处理器及其追问消息的旧 Context 失效，再进入下一个处理器。回复计数和错误归属按处理器隔离；回复序号、消息去重和操作预算按整条消息共享。追问后的业务校验不退还已经占用的冷却，也不自动重做 Guard；需要重新确认权限时由业务明确检查。

自定义 Guard 可以检查新增的 `ctx.kind === 'attachment'` 分支和冻结的 `ctx.matchedAttachments`，完整消息集合仍在 `ctx.attachments`。`ctx.route` 为 `attachment:<控制器名>.<方法名>`。迁移已有 Guard 时，显式判断 button 分支：旧写法 `if (kind === 'command') ... else ...` 的 else 现在还可能是 attachment。附件处理器错误阶段为 `attachment`；发送、Guard、冷却、prompt 错误沿用各自阶段。

筛选只检查消息元信息。扩展名符合 DOCX 并不证明文件内容有效；下载、验证、解析和保存由应用服务处理。运行 `npm run example:attachments` 查看同条图片、分条附件和直接上传三种源码流程。
