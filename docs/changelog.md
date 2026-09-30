# 更新日志

## 0.6.0 · 2026-09-30

首次以 dou-bot 名称公开发布到 npm，采用 MIT 许可证。本手册与可运行示例固定验证此版本。

- 提供静态模块、依赖注入、控制器与 20 个公开装饰器。
- 支持位置参数、Slot、Rest、Option、帮助、自定义前缀和空前缀。
- 提供模块/类/方法级 Guard、场景/用户/角色限制和命令冷却。
- 提供 prompt 多轮输入、超时和取消。
- 支持文本、图片、原始 Markdown、内联按钮和测试入口。
- 面向 QQ 官方群聊和私聊，提供 WS 与 Webhook 接入。

```sh
npm install --save-exact dou-bot@0.6.0
```

[npm 版本页面](https://www.npmjs.com/package/dou-bot/v/0.6.0)。安装标签可能变化，业务项目采用精确版本及锁文件。

## 当前验收边界

WS 已在 Windows 上完成群聊与私聊相关实机验证；Webhook 公网回调与管理者按钮分角色实机仍待专项验收。离线测试通过不代表每个机器人账号都拥有相同平台权限。详细范围见 [框架介绍](./guide/introduction.md)。
