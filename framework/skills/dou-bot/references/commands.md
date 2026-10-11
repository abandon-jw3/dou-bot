# 把用户输入变成命令参数

先确定用户会发送的文本、前缀和期望回复。以下以 dou-bot 0.7.0 为例；默认前缀是 `/`，例如 `/查询 北京 天气`。设置 `commands.prefix: ''` 后才使用不带前缀的命令。

## 选择合适的参数

| 用户输入的特点                         | 选择                       | 使用结果                                 |
| -------------------------------------- | -------------------------- | ---------------------------------------- |
| 固定位置，如 `/问候 小明`              | `@Arg(0)`                  | 字符串或 undefined，可以使用方法默认参数 |
| 固定位置且需要类型、范围或必填校验     | `@Arg(0, options)`         | 按配置解析和校验                         |
| 城市、服务器等关键词可能出现在不同位置 | `@Slot('city', options)`   | 匹配一个原始分词                         |
| 其余内容作为备注或正文                 | `@Rest()`                  | 保留顺序的字符串数组，没有内容时为 []    |
| 页码、开关等明确选项                   | `@Option('page', options)` | 解析长选项或短别名                       |
| 需要完整输入分词作额外分析             | `@Args()`                  | 完整分词快照，不消耗参数                 |
| 需要回复、会话或取消信号               | `@Ctx()`                   | 当前上下文                               |

处理器写在已注册控制器的实例方法上；覆写继承方法时重新声明路由。每个处理器参数都声明来源，包括带默认值的参数。命令名称与 aliases 区分大小写且不含空白；示例词典和前缀由业务决定。多词文本使用引号，例如 `/问候 "Ada Lovelace"`；这里按空白分词，不做中文自然语言切词。

## 用 Slot 接受不同顺序

```ts
import { Slot } from 'dou-bot';

const cityWords = new Set(['北京', '上海', '深圳']);

export function City(): ParameterDecorator {
  return Slot('city', {
    name: '城市',
    required: true,
    match: (text) => cityWords.has(text),
  });
}
```

在处理器中用 `@City() city: string`，再声明查询类型 Slot，即可同时接受 `/查询 北京 天气` 和 `/查询 天气 北京`。完整组合见 [命令示例](../assets/minimal-module.ts)。

Slot 至少提供 choices 或 match；两者同时提供时，输入必须同时满足。match 同步返回 boolean，只做匹配。0.7.0 注入的是原始字符串；需要把别名转成统一名称、查实体或加载用户默认配置时，在处理器中调用业务 Service，异步查询用 await，不放进 match 或静态 default。

一个词同时命中多个 Slot、同一 Slot 收到多个候选值或缺少必填项都会提示输入错误。两个 Slot 若使用同一套城市词典，不能靠不同参数名区分“出发地”和“目的地”；这类输入改用固定位置或明确选项。

## 保留正文与可选参数

解析顺序是 Option → Arg → Slot → Rest。Arg 的下标对应去掉选项后的普通参数；Rest 最后收集未使用的词，声明位置不影响这个行为。

使用 Option、Slot、Rest 或带 options 的 Arg 后，多余普通参数会报错；需要接收备注就加 Rest。只使用 `Arg(index)`、Args、Ctx 的命令可以接受额外词；给已有命令增加校验时，检查原来的输入是否仍然可用。

Rest 不接收有歧义、重复、缺失或错误类型的参数，也不吞掉未知选项。每条命令最多一个 Rest，参数写普通数组，而不是 `...remaining`。Args 只供读取完整分词，不能代替 Rest 接收多余内容。

## 页码与开关

```ts
@Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number
@Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean
```

上面是处理器参数片段。可用 `--page 2`、`--page=2`、`-p 2` 或 `-p=2`。`--detail` 表示 true，false 用 `--detail=false`；`--detail false` 的 false 会被当作普通分词。

- type 默认 string，可选 integer、number、boolean；写了 TypeScript 的 `: number` 不会自动转换输入。
- required 表示必须提供，显式空字符串仍算提供。静态 default 必须符合类型、choices 和范围，不能与 required=true 同用。
- 可选参数没有 default 时注入 undefined，包括 boolean。需要 false 默认值就明确配置。
- 数值范围用于 integer/number；choices 用同类型且不重复的字符串或数字值。
- 未声明的选项、重复传入同一选项及长短别名重复都会报错；不支持 `-dp2` 组合或自动生成 `--no-detail`。
- 选项形状的正文可用引号、开头转义或 `--` 终止符。终止符之后仍可匹配 Slot。

## 让用户知道怎么使用

在模块 imports 中加入 HelpModule，用户可发送 `/help 查询` 或 `/帮助 查询`；名称也可以是命令别名。help 的参数不再带前缀。用 name、description 和 choices 写清楚参数含义；已有同名 help 路由时先处理冲突。

设置 `commands.invalidInput: 'reply'` 后，缺参、类型、范围、歧义等解析错误会回复用法提示；默认 report 只上报错误。业务查询失败不属于解析错误，已知情况由处理器回复说明，未知异常交给应用日志。帮助不会替代实际执行时的权限检查。
