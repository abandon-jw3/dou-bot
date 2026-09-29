# 命令参数与最终使用方式

对应 dd-bot 0.2.0、公开契约 1.3。新增能力不引入运行时依赖，群聊、私聊与两种接入方式共用同一套解析规则。

## 可运行示例

```sh
npm run example:query
```

[examples/query.ts](../examples/query.ts) 使用测试入口运行真实装饰器、参数解析和消息编码，不读取 `.env`，不发真实 QQ 消息。示例返回解析结果；业务查询服务由应用自行接入。

业务使用方式：

```ts
import { BotFactory, Command, Controller, HelpModule, Module, Option, Rest, Slot } from 'dd-bot';

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

声明错误（重复 Slot 名、多个 Rest、重复 Option 名/别名、重复位置消费、默认值不合法等）在应用初始化时拒绝，先于实例构造和网络连接。完整签名见 [公开契约](./public-api.d.ts)，验证覆盖见 [验证记录](./validation-report.md)。
