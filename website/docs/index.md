---
layout: home
hero:
  name: dou-bot
  text: '<span class="hero-phrase">用装饰器编写</span> <span class="hero-phrase">QQ 机器人</span>'
  tagline: 从第一个 hello，到模块、权限和多轮对话。适用于 dou-bot 0.6.0 的完整中文手册。
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quick-start
    - theme: alt
      text: 查看 API
      link: /api/decorators
features:
  - title: 模块与依赖注入
    details: 用 Module、Controller 和 Service 组织业务，让配置和服务的职责清楚可见。
    link: /guide/modules
  - title: 自然的命令参数
    details: Slot 识别不同顺序的参数，Rest 收集补充内容，Option 处理长短选项。
    link: /guide/parameters
  - title: 权限与多轮对话
    details: 组合模块、类和方法级 Guard，用 prompt 等待用户的下一条输入。
    link: /guide/prompts
  - title: 两种 QQ 接入方式
    details: 面向官方群聊和私聊，支持 WebSocket 与 Webhook，共用同一套业务模块。
    link: /guide/ws
---

## 从一个依赖开始

```sh
npm install --save-exact dou-bot@0.6.0
```

运行环境为 Node.js 24+，本手册使用 Node.js 24.21.0、TypeScript 5.9.3 和 ESM。查看 [快速开始](./guide/quick-start.md)，编写并运行第一个机器人；也可以先试试 [离线示例](./guide/testing.md)。

## 找到你需要的内容

- **第一次使用**：[框架介绍](./guide/introduction.md) → [快速开始](./guide/quick-start.md) → [模块与依赖注入](./guide/modules.md)。
- **正在编写业务**：[命令参数](./guide/parameters.md)、[权限与冷却](./guide/guards.md)、[二次输入](./guide/prompts.md)。
- **查询细节**：[20 个装饰器](./api/decorators.md)、[应用 API](./api/application.md)、[错误与日志](./api/errors.md)。
- **准备运行**：[WS](./guide/ws.md)、[Webhook](./guide/webhook.md)、[Windows 部署](./guide/deployment.md)。

本手册及示例公开可读，代码以 npm 上的 0.6.0 为准。[反馈文档问题](https://github.com/abandon-jw3/dou-bot-docs/issues)。
