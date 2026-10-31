# 添加命令与参数

- 在已注册 Controller 的实例方法上声明 `@Command('查询')`，返回字符串即可回复。
- 默认输入为 `/查询`；应用配置 `commands.prefix: ''` 后才使用无前缀命令。
- 每个方法参数都声明来源，包括有默认值的参数。名称和 aliases 区分大小写，不含空白。
- 参数按空白分词，多词内容用引号，例如 `/问候 "Ada Lovelace"`。

## 选择参数装饰器

| 输入需求                       | 声明                       | 注入值                             |
| ------------------------------ | -------------------------- | ---------------------------------- |
| 固定位置的文本                 | `@Arg(0)`                  | 字符串或 undefined，可用方法默认值 |
| 固定位置且需要校验             | `@Arg(0, options)`         | 按配置解析的值                     |
| 城市、服务器等关键词，顺序可变 | `@Slot('city', options)`   | 一个匹配值，可归一化               |
| 剩余文字作为正文               | `@Rest()`                  | 按原顺序排列的字符串数组           |
| 页码、开关等选项               | `@Option('page', options)` | 按配置解析的值                     |
| 读取完整输入分词               | `@Args()`                  | 不消费参数的分词快照               |
| 回复、追问、取消信号           | `@Ctx()`                   | 当前上下文                         |

完整组合见 [命令模块](../assets/minimal-module.ts) 和 [测试](../assets/minimal-module.test.ts)。

## 关键词与别名

以下是处理器的参数片段，相关装饰器从 `dou-bot` 导入：

```ts
@Slot('server', {
  name: '服务器',
  description: '双梦也是梦江南',
  choices: ['梦江南', '双梦'],
  default: '双梦',
  normalize: (text) => text === '双梦' ? '梦江南' : text,
})
server: string
```

- 输入“梦江南”或“双梦”都得到“梦江南”；未输入时也使用归一化后的默认值。
- Slot 至少声明 `choices` 或 `match`；同时声明时必须同时满足。
- `match` 同步返回 boolean；`normalize` 同步返回字符串，结果不重新匹配，允许空字符串。
- 完成文字校验后才归一化。默认值在启动时转换一次；无默认值且未输入时得到 undefined，不调用回调。
- 同时输入两个别名仍报重复；一个词命中多个 Slot 会报歧义。出发地、目的地共用词典时改用 Arg 或 Option。
- 回调应无副作用；异步查询放 Service 或 [上下文中间件](context.md)。数据库默认值由处理器明确选择，不写进静态 `default`。

复用业务词典时，可以封装自己的参数装饰器：

```ts
import { Slot } from 'dou-bot';

export function City(): ParameterDecorator {
  return Slot('city', { choices: ['北京', '上海'], required: true });
}
```

## 页码与开关

```ts
@Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number
@Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean
```

- 页码支持 `--page 2`、`--page=2`、`-p 2`、`-p=2`。
- 开关用 `--detail` 或 `--detail=false`；`--detail false` 中的 false 是普通分词。
- `type` 默认 string，也可用 integer、number、boolean。TypeScript 类型标注不会自动转换输入。
- `required` 与 `default` 不能同时使用；可选参数无默认值时为 undefined，包括 boolean。
- 默认值需满足类型、choices 和范围。数值范围用于 integer/number，choices 使用同类型的字符串或数字。
- 未知或重复选项报错，不支持 `-dp2` 或自动生成 `--no-detail`。

## 接收剩余正文

- 解析顺序是 Option → Arg → Slot → Rest，与方法参数声明顺序无关。
- Arg 的下标对应去掉选项后的普通参数；Rest 收集剩余词，不接收错误、歧义或重复参数。
- 1.0.0-rc.0 使用 Option、Slot 或带配置的 Arg 后，未接收的普通文字会报错；该版本用 Rest 接收额外文字。
- 后续版本（尚未发布）默认忽略未接收的普通文字，Rest 只在业务需要读取时声明；缺参、类型错误、重复匹配和未知选项仍会报错。
- 只用 `Arg(index)`、Args、Ctx 的命令允许额外词；Args 不能代替 Rest 消费它们。
- 每条命令最多一个 Rest，参数写数组，不写 `...remaining`。
- 类似选项的正文可加引号、开头转义或放在 `--` 后；`--` 后仍可匹配 Slot。
- Args、Rest 和原消息不会被 Slot.normalize 改写。

## 帮助与错误提示

- 模块 imports 加入 `HelpModule`，用户可发送 `/help 查询` 或 `/帮助 查询`；help 参数不再带前缀。
- 用 `name`、`description`、`choices` 写清含义；继承后覆写处理器时重新声明路由。
- 设置 `commands.invalidInput: 'reply'` 自动回复输入错误；默认 report 只上报。
- 查询无结果等已知业务情况由处理器回复；未知异常交给应用的 `onError` 或日志。
