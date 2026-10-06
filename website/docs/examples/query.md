# 无序参数与 City

让用户输入“北京 天气”或“天气 北京”，都能得到相同的参数结果。这个示例把城市匹配封装成 `@City()`，并用 Slot、Rest 和 Option 接收主题、备注和选项。

示例只回显解析结果。接入自己的查询服务后，可以把这些参数交给 Service 获取实际数据。

## 添加到你的项目

先准备 [快速开始](../guide/quick-start.md) 中的项目、启动入口和 `.env`。在 `src/` 中添加下面两个文件，用这里的 AppModule 替换 hello 示例的根模块；保留 `src/main.ts`。

### src/city.decorator.ts

<<< @/../examples/query/city.decorator.ts

### src/app.module.ts

<<< @/../examples/query/app.module.ts

## 运行这个示例

在自己的项目根目录执行：

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

发送 `/查询 今天 天气 北京 带伞 -p 2 -d`，预期得到：

```json
{ "city": "北京", "topic": "天气", "notes": ["今天", "带伞"], "page": 2, "detail": true }
```

## 试试不同输入

| 发送内容               | 预期结果                                   |
| ---------------------- | ------------------------------------------ |
| `/查询 天气 北京`      | 识别城市和主题；page 为 1、detail 为 false |
| `/查询 北京 天气`      | 交换顺序仍得到相同结果                     |
| `/查询 北京 上海 天气` | 提示城市重复，不执行查询                   |
| `/查询 北京`           | 提示缺少主题                               |
| `/echo a "b c" --flag` | 返回 `["a", "b c", "--flag"]`              |
| `/repeat hi 2`         | 返回 `hi hi`                               |

启动入口保留 `commands.invalidInput: 'reply'`，才能把输入错误回复给用户。群聊中先 @机器人；按 Ctrl+C 结束运行。

修改 City 的城市集合即可接收自己的词表。参数匹配规则和错误处理见 [命令参数](../guide/parameters.md)，为查询逻辑编写断言可参考 [离线测试](../guide/testing.md)。
