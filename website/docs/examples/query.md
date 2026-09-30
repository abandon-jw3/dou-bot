# 无序参数与 City

发送 `/查询 今天 天气 北京 带伞 -p 2 -d`，得到城市=北京、主题=天气、备注=[今天, 带伞]、page=2、detail=true。交换北京和天气的顺序，结果保持相同。

`/查询 北京 上海 天气` 会因为城市重复而失败；`/查询 北京` 缺少主题也失败。Rest 不吞掉这些错误。此例只回显解析结果，不访问天气服务。

`/echo a "b c" --flag` 展示 Args；`/repeat hi 2` 展示显式整数转换。

## 源文件

### examples/query/city.decorator.ts

<<< @/../examples/query/city.decorator.ts

### examples/query/app.module.ts

<<< @/../examples/query/app.module.ts

## 运行这个示例

克隆主仓库后，进入 `website` 工程执行：

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot/website
npm ci
npm run examples:build
```

将 `examples/.env.example` 复制为当前目录的 `.env`（即仓库中的 `website/.env`），填入自己的凭证。然后运行：

```sh
node --env-file=.env .examples-build/examples/main.js query
```

共享入口默认使用 WS 和 / 前缀。设置 QQ_TRANSPORT=webhook 可以切换接入，部署前阅读 [Webhook 指南](../guide/webhook.md)。按 Ctrl+C 关闭实例。

需要独立业务工程时，先完成 [快速开始](../guide/quick-start.md)，再替换 AppModule 和它依赖的文件；保留相应相对导入。

## 离线验收

执行 npm test，无需 QQ 凭证。对应断言包含在 [examples.test.ts](https://github.com/abandon-jw3/dou-bot/blob/main/website/tests/examples.test.ts)。这验证模块、解析和消息编码，不代表当前账号的平台权限或客户端显示已通过实机测试。
