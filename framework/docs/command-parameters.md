# 命令参数

按输入方式选择装饰器。除标注“尚未发布”的部分外，本页适用于 **0.7.0**。

## 参数 API

| 装饰器                    | 用途                      | 注入值                 |
| ------------------------- | ------------------------- | ---------------------- |
| `@Arg(index)`             | 按位置取值，下标从 0 开始 | `string \| undefined`  |
| `@Arg(index, options)`    | 按位置取值并校验          | 指定类型或 `undefined` |
| `@Option(name, options?)` | 读取 `--page 2`、`-p 2`   | 指定类型或 `undefined` |
| `@Slot(name, options)`    | 从任意位置匹配一个词      | `string \| undefined`  |
| `@Rest(options?)`         | 收集剩余普通参数          | `string[]`             |
| `@Args()`                 | 获取全部分词，不参与消费  | `string[]`             |
| `@Ctx()`                  | 回复、提问或读取消息信息  | `MessageContext`       |

## 可运行示例

从 dou-bot 导入装饰器，将以下方法放入已注册控制器：

```ts
@Command('查询')
query(
  @Slot('city', { choices: ['北京', '上海'], required: true }) city: string,
  @Slot('topic', { choices: ['天气', '空气质量'], required: true }) topic: string,
  @Rest() notes: string[],
  @Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number,
): string {
  return `${city} ${topic}；备注：${notes.join(' ')}；页码：${page}`;
}
```

- `/查询 北京 天气` 与 `/查询 天气 北京` 得到相同结果。
- `/查询 今天 天气 北京 -p 2`：城市=北京，主题=天气，备注=今天，页码=2。
- 多个城市或缺少主题会报错；完整项目见 [查询示例](https://abandon-jw3.github.io/dou-bot/examples/query.html)。

## 类型、必填与默认值

`Arg` 和 `Option` 的配置：

| 字段               | 用法                                               |
| ------------------ | -------------------------------------------------- |
| name / description | 帮助中的名称与说明                                 |
| type               | `string`（默认）、`integer`、`number`、`boolean`   |
| required           | 默认 `false`；只检查是否提供，空字符串算已提供     |
| default            | 缺省值，需通过校验；不能与 `required: true` 共用   |
| choices            | 非空、无重复的候选值，与 type 一致；不支持 boolean |
| min / max          | 数字范围，包含边界；integer 边界须为安全整数       |
| alias              | 仅 Option，单个 ASCII 字母，如 `p`                 |

- `: number` 不会自动转换，需显式设置 `type`。
- `integer` 接收十进制安全整数；`number` 接收有限十进制数，可用科学计数法。
- `boolean` 的显式值只接受小写 `true`、`false`。
- 未设默认值的可选参数缺省为 `undefined`。

## Slot：不限定输入顺序

- 至少提供 `choices` 或 `match`；同时提供时，两项都要通过。
- 每个 Slot 只接收一个分词，不做中文分词或模糊匹配。
- `match` 必须同步返回布尔值且无副作用；默认值也会接受匹配校验。
- 一个词命中多个 Slot 会报歧义；多个词命中同一 Slot 会报重复。
- 包含空格的单个参数使用引号，例如 `"未来 三天"`。
- 0.7.0 注入匹配到的原词；别名转换和异步查询放在业务服务中。

## 解析与消费顺序

1. **Option**：提取选项及其值。
2. **Arg**：按剩余普通参数的固定下标取值。
3. **Slot**：匹配未被消费的分词。
4. **Rest**：按原顺序收集剩余分词。

- 每个命令最多一个 Rest，声明位置不影响收集顺序。
- Rest 和 Args 使用普通数组参数，不写 `...rest`。
- Args 保留完整分词，包括选项和 `--`；它不消费参数，也不能代替 Rest。
- 使用 Option、Slot、Rest 或带配置的 Arg 后，会拒绝多余参数、未知选项等错误输入。
- 只用 `Arg(index)` / Args / Ctx 时，多余参数不报错，缺参为 `undefined`，可用 JS 默认参数。

## 选项语法

| 输入                                   | 含义                            |
| -------------------------------------- | ------------------------------- |
| `--page 2`、`--page=2`、`-p 2`、`-p=2` | 指定选项值                      |
| `--detail`、`-d`                       | 布尔值 true                     |
| `--detail=false`、`-d=false`           | 布尔值 false                    |
| `--detail false`                       | 开关为 true，`false` 是普通参数 |
| `--offset -3`                          | 数字负值                        |

- 长名称以 ASCII 字母开头，后续可用字母、数字、下划线、连字符；区分大小写。
- 不支持 `-dp2` 合并写法，也不会自动生成 `--no-detail`。
- 重复指定同一选项（含长短别名）或使用未知选项都会报错。
- 把选项形状当成普通文字时，使用引号、开头转义或 `--`：

```text
/查询 北京 天气 "--note"
/查询 北京 天气 \-x
/查询 北京 天气 -- --note -x
```

- `--` 不进入 Rest，其后的文字仍可匹配 Slot。
- 选项的字符串值若以 `--` 或字母短选项形状开头，使用引号或等号写法。

## 帮助与输入错误

- 导入 `HelpModule` 后，用 `/help 查询` 查看参数说明。
- 设置 `commands.invalidInput: 'reply'`，向用户回复输入错误和用法；默认只记录错误。
- 输入错误不执行处理器，也不占冷却。
- 匹配器抛错或返回错误类型属于程序错误，只上报。
- 重复声明、无效默认值等配置问题在创建应用时报告。

## Slot 归一化

**尚未发布，npm 0.7.0 不支持 normalize。**

将别名转换成处理器使用的统一值：

```ts
@Command('状态')
status(
  @Slot('server', {
    name: '服务器',
    description: '双梦是梦江南的别名',
    required: true,
    choices: ['梦江南', '双梦'],
    normalize: (text) => text === '双梦' ? '梦江南' : text,
  })
  server: string,
): string {
  return `正在查询 ${server} 的状态`;
}
```

- `/状态 梦江南`、`/状态 双梦` 都注入“梦江南”。
- `/状态 梦江南 双梦` 仍报重复，不自动合并。
- 先完成全部文字校验，再按参数顺序归一化；每个显式输入调用一次。
- 回调须同步、无副作用并返回字符串；结果不重新匹配，允许空字符串。
- default 在启动时校验并归一化一次；可选参数无默认值时注入 undefined，不调用回调。
- Args、Rest、Context 和原始消息不变；帮助展示原始 choices/default，用 description 说明别名。
- 非函数配置报 CONFIG；抛错、非字符串或 Promise 返回值报 HANDLER_CONTRACT。
- 归一化失败不占冷却，不自动回复输入提示；默认值失败会阻止启动。
- 异步查询放在业务服务中；配置保存函数引用，闭包内字典由业务管理。

### 封装业务装饰器

```ts
import { Slot } from 'dou-bot';

const serverNames = new Map([
  ['梦江南', '梦江南'],
  ['双梦', '梦江南'],
]);

export function Server(): ParameterDecorator {
  return Slot('server', {
    name: '服务器',
    description: '双梦是梦江南的别名',
    required: true,
    match: (text) => serverNames.has(text),
    normalize: (text) => serverNames.get(text)!,
  });
}
```

处理器用 `@Server() server: string` 即可复用。

## 附件参数

| 发送方式                       | 入口                       |
| ------------------------------ | -------------------------- |
| 指令与图片同条发送             | Images / Attachments       |
| 指令后单独发送视频、音频或文件 | prompt + selectAttachments |
| 直接上传                       | OnAttachment，见下节       |

### 同条消息的附件

```ts
@Command('收图')
receive(@Images({ minCount: 1, maxCount: 4 }) images: readonly Attachment[]): string {
  return `收到 ${images.length} 张图片。`;
}
```

- `@Attachments()` 获取全部顶层附件；`@Images()` 只取具体的 image MIME。
- 两者注入 readonly Attachment[]，支持 name、description、minCount、maxCount。
- 默认最少 0 个、无上限；无匹配时为 []。数量统计筛选结果，上限 0 可拒绝附件。
- 上下限须为非负安全整数，上限不得小于下限；非法声明报 CONFIG。
- Guard 和文字校验通过后检查数量，失败报 PARAMETER_PARSE，不占冷却。
- 命令可设置 commands.invalidInput: 'reply' 回复提示；帮助展示数量要求。
- 不消费文字、不启用严格文字模式；各参数是独立浅冻结数组。

### 分条接收视频、音频或文件

在异步处理器中使用：

```ts
const answer = await ctx.prompt('请发送 1 个文件，或发送“取消”。');
if (answer.status !== 'received') return;
const result = selectAttachments(answer.message.attachments, {
  kind: 'file',
  minCount: 1,
  maxCount: 1,
});
if (result.status === 'invalid') {
  await answer.message.reply(`请发送 1 个文件，本条匹配 ${result.count} 个。`);
  return;
}
await answer.message.reply(`收到 ${result.attachments.length} 个文件。`);
```

- 视频改用 kind: 'video'，音频改用 'audio'。
- 用新消息的 reply 引用附件；本例校验失败后结束，重问或累计由业务编写。
- 后续回答不重跑 Guard、不退还原命令冷却；取消和超时见 [prompt](prompts.md)。

### selectAttachments

- 输入规范化的附件数组，如 ctx.attachments，不解析 QQ 原始 payload。
- 选项：kind（默认 all）、minCount（默认 0）、maxCount（默认无上限）。
- 先筛选再检查数量；错误类型通常使匹配数量为 0，要必填时设置 minCount: 1。

| kind          | 匹配范围                                       |
| ------------- | ---------------------------------------------- |
| all           | 全部，包括缺失或未知类型                       |
| image / video | 对应的具体 MIME                                |
| audio         | audio MIME 或 QQ 的 voice 标记                 |
| file          | QQ 的 file 标记，或其他合法 MIME，如 PDF、文本 |

- MIME 忽略首尾空白、大小写及类型参数；不按文件名或 URL 猜测。
- 裸类型、残缺 MIME、image/* 范围值只进入 all；QQ 标为 file 的音频也按 file 选择。
- valid 返回 attachments；invalid 返回 reason（too-few / too-many）、count、limit。
- 数量失败不抛异常、不调用 onError、不自动提示，也不截断附件。
- 未知 kind、非法上下限等调用错误报 HANDLER_CONTRACT。
- 结果及成功数组冻结，保留原顺序、重复项、对象引用和原始元信息。
- 不读取引用附件或 ARK 预览图；voiceWavUrl / asrReferText 保留为元信息，不触发命令。
- 下载、内容验证、转码和保存交给自己的服务。

## 身份参数

用于 Command、OnButton、OnAttachment，无配置项：

| 装饰器  | 注入类型               | 信息                                                 |
| ------- | ---------------------- | ---------------------------------------------------- |
| User    | UserInfo               | id，以及可选 username、bot、memberRole               |
| UserId  | string                 | 当前用户 OpenID，与 ctx.userId 一致                  |
| Group   | GroupInfo \| undefined | 仅群 id，私聊为 undefined                            |
| GroupId | string \| undefined    | 群 OpenID，私聊为 undefined                          |
| Role    | GroupRole \| undefined | member/admin/owner；私聊、按钮、未知角色为 undefined |

```ts
@Command('我是谁')
who(@UserId() userId: string, @GroupId() groupId: string | undefined): string {
  return `用户：${userId}；群：${groupId ?? '私聊'}`;
}
```

- 身份对象是冻结快照，只读当前事件，不查询资料或推断历史身份。
- 用户名为空、bot 为 false 时原样保留；按钮只提供本次操作者 ID 及适用的群 ID。
- OpenID 不是 QQ 号或群号，不能假定同一用户在群聊和私聊 ID 相同。
- 不消费文字或附件，不出现在帮助中；缺失信息不阻止执行。
- Role 只读信息，权限限制使用 [访问限制](access-control.md)。

## 自动处理上传附件

```ts
@OnAttachment({
  filename: /^报告_\d{8}\.docx$/u,
  extension: 'docx',
  invalidInput: 'reply',
})
accept(@Attachments({ maxCount: 1 }) files: readonly Attachment[]): string {
  return `已接收 ${files.length} 个匹配文件。`;
}
```

- 用户直接上传“报告_20261007.docx”即可触发。
- filename：完整字符串区分大小写；正则按 flags 匹配，完整匹配加 ^ / $。
- extension：单个扩展名，如 docx/.docx，忽略大小写，不支持通配符或复合后缀。
- kind：同 selectAttachments，默认 all；所有条件必须命中同一附件。
- 省略条件接收全部带附件的消息；无文件名时不能匹配 filename/extension。
- invalidInput 默认 report，可设 reply；与 commands.invalidInput 独立。

### 参数和权限

- Attachments 注入当前处理器匹配集合，Images 再筛选图片；ctx.attachments 保留整条消息的附件。
- 支持 Ctx、附件和身份参数，不支持文字参数，不进入命令帮助。
- 支持 Guard、场景/用户/角色限制、Cooldown 和 await prompt。
- 数量错误不占冷却；返回消息自动回复，手动 reply/prompt 后返回 void。
- 自定义 Guard 用 kind === 'attachment' 读取 matchedAttachments；route 为 attachment:控制器名.方法名。

### 路由顺序

1. 等待中的 prompt 优先接收回答。
2. 已识别命令优先处理；拒绝或失败后不转交附件处理器。
3. 其余消息交给所有匹配处理器，每个调用一次。

- 多个处理器独立、顺序运行，一个失败不阻止其他处理器；应用关闭会中断后续处理。
- 导入模块在先，控制器按注册顺序，同控制器内按方法名排序。
- 追问结束后才运行下一个处理器；回答不广播，后者仍处理原始上传消息。
- 每个处理器结束后 Context 失效；整条消息共享回复序号、去重和操作预算。
- 文件名或 MIME 匹配不等于内容有效，交给自己的服务验证和处理。

完整运行步骤见 [附件示例](https://abandon-jw3.github.io/dou-bot/examples/attachments.html)。

## 使用未发布的上下文数据

- 源码提供 ContextValue，在文字、归一化、附件校验及身份注入后读取数据，再进入冷却。
- 不消费输入，不出现在帮助中；npm 0.7.0 不支持。
- 注册与懒加载见 [上下文中间件](context-middleware.md)。
