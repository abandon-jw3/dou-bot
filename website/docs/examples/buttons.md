# Markdown 与按钮

给机器人添加一个菜单：用户发送 `/menu` 后，可以点击“确认”、打开文档，或再次发送菜单命令。

## 添加到你的项目

先准备 [快速开始](../guide/quick-start.md) 中的项目、启动入口和 `.env`。把下面代码保存为 `src/app.module.ts`，替换 hello 示例的根模块，保留 `src/main.ts`。

<<< @/../examples/buttons/app.module.ts

## 运行这个示例

在自己的项目根目录执行：

```sh
npx tsc -p tsconfig.json
node --env-file=.env dist/main.js
```

## 试一试

1. 发送 `/menu`，看到“请选择操作”和三个按钮。
2. 点击“确认”，收到 `确认成功。`；`@OnButton('docs:confirm')` 负责处理这次点击。
3. 点击“阅读文档”，打开文档站。
4. 点击“再次打开”，发送 `/menu` 并重新展示菜单。

群聊中先 @机器人发送命令；按 Ctrl+C 关闭程序。点击已确认但没有回复时，检查机器人是否拥有普通消息发送权限，具体见 [排错指南](../guide/troubleshooting.md)。

本例使用默认的自动交互确认。接入修改数据等业务时，在回调中校验 data、操作对象及用户权限；确认收到点击不代表业务操作成功。按钮类型、权限及手动确认方式见 [Markdown 与按钮](../guide/buttons.md)。
