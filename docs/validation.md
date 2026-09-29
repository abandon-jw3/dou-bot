# 验证记录

日期：2026-09-30。应用 0.1.0，安装依赖为 dd-bot SDK 0.3.0，TypeScript 5.9.3。

## 本地与数据接口

- 使用独立目录和 package-lock.json 安装 vendor SDK，没有导入框架内部源码，也不需要 @types/ws。
- 本地 npm run check 通过：SDK 安装包及公开导入检查、类型、Lint、格式、文档链接、构建和 10 项业务测试。测试覆盖 DI、City/Slot 无序匹配、Rest 备注、温度选项、Guard、冷却、帮助、刷新所有权、按钮过期、上游错误、超时、取消和响应大小上限。
- 城市定位接口已实际返回北京（国家 CN）的坐标；真实天气服务返回北京时间 2026-09-30 02:30 的模型数据，气温 16.5°C、湿度 33%，并返回三天预报。这只是本轮接口响应记录，不能作为后续时刻的天气信息。
- 线上请求使用正式 Open-Meteo HTTPS 域名；失败不会回退到演示数据。

## GitHub CI

已创建 [abandon-jw3/dd-bot-example 私有仓库](https://github.com/abandon-jw3/dd-bot-example)。[首次 CI](https://github.com/abandon-jw3/dd-bot-example/actions/runs/36615024015) 在 Windows、Linux 上均通过，验证提交为 `6f93a9d63ddc04c6057b197662969ed4477f8b1d`。两套环境均从仓库内的 SDK 安装包执行 npm ci 和 npm run check，不依赖本机框架源码目录。

## QQ 实机步骤

已准备最长 10 分钟、带随机前缀和临时会话授权的实机入口。QQ 群聊/私聊天气查询、刷新按钮正在等待用户参与验证；将按实际结果更新，不把模拟响应测试或独立天气接口请求当作 QQ 实机通过。

界面显示与按钮文字保留需要用户确认；Webhook 公网接入继续等待部署环境，不在本次 WS 验收中。
