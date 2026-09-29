# 命令、Slot、Rest 和选项

## 选择参数形式

| 声明                       | 语义                                                       |
| -------------------------- | ---------------------------------------------------------- |
| `@Arg(0)`                  | 旧位置参数，字符串或 undefined，支持业务方法的 JS 默认参数 |
| `@Arg(0, options)`         | 位置参数，显式类型、必填、默认值、枚举或数值范围           |
| `@Slot('city', options)`   | 根据业务规则识别任意位置的一个字符串分词                   |
| `@Rest({ name: '备注' })`  | 收集所有未消费的普通分词，保持原顺序；没有剩余时为 []      |
| `@Args()`                  | 完整分词快照，包括选项和 --，不参与消费                    |
| `@Option('page', options)` | 长选项及可选的单字母短别名                                 |
| `@Ctx()`                   | 当前处理器上下文                                           |

所有处理器参数都需要参数装饰器，包括有默认值的参数。命令装饰器只用于实例方法；继承方法可以复用，覆写但不重新声明路由时，原路由不再注册。

`@Command('查询', { aliases: ['查'], description: '查询信息' })` 的名称和别名大小写敏感、不能带空白。注册冲突在启动时失败。默认前缀为 `/`；`commands.prefix` 是一个字符串，可设为 `''`，但不能含空白。群聊/私聊使用同一前缀；空前缀不会额外保留 `/`。

## 无序 Slot 与业务装饰器

```ts
import { Slot } from 'dd-bot';

const cityWords = new Set(['北京', '上海', '深圳']);

export function City(): ParameterDecorator {
  return Slot('city', {
    name: '城市',
    required: true,
    match: (text) => cityWords.has(text),
  });
}
```

City() 是返回 Slot 装饰器的工厂。业务方法中 `@City() city: string` 可代替重复声明规则；城市词典属于应用，不是框架内置数据。可编译的完整组合见 [minimal-module.ts](../assets/minimal-module.ts)。

Slot 至少声明非空 choices 或同步 match。两者同时使用时取交集。match 必须同步返回 boolean；不要在其中请求 API、写状态或返回 Promise。匹配结果仍为原始分词字符串，没有自动 transform/DTO/实体注入；别名归一化或实体查询放进 Service。

用户可以输入 `查询 北京 天气` 或 `查询 天气 北京`。额外声明 Rest 后，`查询 今天 天气 北京 详细` 的 Rest 是 `['今天', '详细']`。Rest 在方法参数中的位置不影响其最后收集的行为。

一个分词命中多个 Slot、一个 Slot 收到多个候选值（即使值相同）或缺少 required Slot 都是输入错误，不能由 Rest 接收。每命令最多一个 Rest，注入普通数组参数，不写成 JS 的 `...remaining`。Slot 名不能重复；两个都接受全部城市的“出发地/目的地” Slot 无法靠改名称消除歧义，应使用明确选项、位置或业务标记区分。

## 解析顺序与兼容边界

新参数模式按以下顺序消费：提取 Option 及其值 → Arg 按剩余普通参数的固定下标绑定 → Slot 匹配尚未消费的分词 → Rest 按原顺序收集。

添加 Option、Slot、Rest 或 Arg 的 options 任意一项即启用严格模式。无 Rest 时，多余普通参数会报错；Args 不是兜底。只使用旧 Arg(index)/Args/Ctx 的命令继续接受额外参数，并把选项形状的词当成字符串；扩展旧命令时显式决定是否需要 Rest。

单引号、双引号、反斜杠转义保留一个分词内的空格及空字符串。此过程不做中文分词或自然语言猜测。

## 类型与选项

```ts
@Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number
@Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean
```

- runtime type 默认 string；支持 string/integer/number/boolean，不根据 TS 的 `: number` 自动转换。
- integer 只接受十进制安全整数；number 只接受有限十进制数（含科学计数法）；boolean 值是小写 true/false。
- required 检查是否提供；显式空字符串算已提供。default 必须满足 type、choices、min/max，不能与 required=true 同用。
- 数字范围仅用于 number/integer；choices 是非空且不重复的同类型字符串/数字数组，boolean 不用 choices。
- name/description 用于提示和帮助。没有 default 的可选标量缺省为 undefined，包括 boolean。

长选项支持 `--page 2`、`--page=2`；短别名支持 `-p 2`、`-p=2`。长名称以 ASCII 字母开始，随后可含字母、数字、下划线和连字符；短别名是一个 ASCII 字母。重复选项（包括混用别名）拒绝，不支持短选项组合 `-dp2`。

`--detail` 或 `-d` 表示 true，不消费下一个词。false 写为 `--detail=false`；`--detail false` 中的 false 是普通参数。没有自动生成的 `--no-detail`。

未知选项不会被 Rest 吞掉；把选项形状作为正文时使用引号、开头转义或 `--`。终止符自身不进 Rest，后续词仍能匹配 Slot。Args 仍保留完整分词快照。

## 帮助和错误提示

在模块 imports 中加入 HelpModule 才注册 help/帮助。`help 查询` 接受不带前缀的命令名或别名；已有 help/帮助 同名路由会冲突。帮助由声明生成，不运行 Guard 或自动隐藏受限命令。

commands.invalidInput 默认 report；设为 reply 会把框架的解析、缺参、歧义、类型/范围错误及用法回复给用户。业务异常、错误的 Slot 匹配器或任意抛出的 FrameworkError 不会自动变成输入提示；业务预期错误由 Controller 明确转换为合适回复。
