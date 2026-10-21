# 多机器人与后台通知

- `/account` 回复来源机器人的 AppID 与场景。
- `/notify-here` 演示用完整地址主动发送到当前会话。
- 外部 WS 或定时任务调用同一个 Notifications.send；传入保存的 BotTarget。

## 业务模块

创建 `src/notifications.module.ts`，再在根模块 imports 中注册 NotificationsModule：

<<< @/../examples/multi-bot/app.module.ts

## 两个账号的离线测试

下面的测试直接运行该模块，验证账号回复、后台发送和单账号停止/恢复。
将测试导入路径改为自己项目的 notifications.module.ts：

<<< @/../tests/multi-bot.test.ts

## 连接 QQ

- 按 [快速开始](../guide/quick-start.md) 配置数据库和 AppFactory。
- 在 bots 中添加账号；完整项目 [example](https://github.com/abandon-jw3/dou-bot/tree/main/example) 支持可选 QQ_APP_ID_B / QQ_APP_SECRET_B。
- 主动发送是否可用需要实际 QQ 账号权限验证；离线测试不代表平台收发通过。
