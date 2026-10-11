---
layout: home
hero:
  name: dou-bot
  text: '<span class="hero-phrase">一个轻量化的</span><span class="hero-phrase">机器人框架</span>'
  tagline: 用 TypeScript 开发 QQ 官方群聊和私聊机器人。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: 查看 API
      link: /api/decorators
features:
  - title: 模块与依赖注入
    details: 用 Module 注册功能，向 Controller 注入业务服务。
    link: /guide/modules
  - title: 命令与参数
    details: 支持位置参数、无序匹配、长短选项和自动帮助。
    link: /guide/parameters
  - title: 权限与多轮对话
    details: 限制用户权限和调用频率，用 prompt 继续提问。
    link: /guide/prompts
  - title: 两种 QQ 接入方式
    details: 选择 WebSocket 或 Webhook，复用同一套业务模块。
    link: /guide/ws
---

## 创建你的第一个机器人

```sh
npm install --save-exact dou-bot@0.7.0
```

- 运行环境：Node.js **24.x**，最低 **24.0.0**。
- 教程使用：Node.js **24.21.0**、TypeScript **5.9.3**、ESM。
- [快速开始](./guide/quick-start.md)：运行第一个机器人。
- [离线测试](./guide/testing.md)：无需 QQ 凭证体验业务。

## 找到你需要的内容

- **第一次使用**：[框架介绍](./guide/introduction.md) → [快速开始](./guide/quick-start.md) → [模块与依赖注入](./guide/modules.md)。
- **编写业务**：[命令参数](./guide/parameters.md)、[附件](./guide/attachments.md)、[身份信息](./guide/identity.md)、[权限与冷却](./guide/guards.md)、[二次输入](./guide/prompts.md)。
- **查询细节**：[装饰器参考](./api/decorators.md)、[应用 API](./api/application.md)、[错误与日志](./api/errors.md)。
- **准备运行**：[WS](./guide/ws.md)、[Webhook](./guide/webhook.md)、[Windows 部署](./guide/deployment.md)。

本手册适用于 dou-bot 0.7.0。遇到问题可先查阅 [排错指南](./guide/troubleshooting.md)，也可以 [反馈文档问题](https://github.com/abandon-jw3/dou-bot/issues)。
