# dou-bot

面向 QQ 官方群聊和私聊的轻量 TypeScript 机器人框架，支持 WebSocket 与 Webhook。

> 本分支面向尚未发布的新版本。使用框架请从配套业务示例开始。

## 开始使用

- [在线用户文档](https://abandon-jw3.github.io/dou-bot/)：安装、功能指南和 API。
- [SDK 安装与使用](framework/README.md)：SDK 功能与安装方式；当前介绍尚未发布的新版本。
- [业务示例](example/README.md)：复制后即可开发，包含命令、附件、权限和对话。
- [dou-bot 技能](framework/skills/dou-bot/SKILL.md)：辅助编写机器人业务。

## 项目目录

| 目录                              | 用途                           |
| --------------------------------- | ------------------------------ |
| [framework/](framework/README.md) | SDK、源码示例、测试和配套技能  |
| [example/](example/README.md)     | 独立业务项目，使用固定源码 SDK |
| [website/](website/README.md)     | 新版本用户文档与可运行教程     |

- 三个工程独立安装依赖，没有 workspaces 或源码链接。
- 根 package.json 仅提供跨工程命令，无需在根目录执行 npm install。
- **0.8.0 已发布**：新增 Slot.normalize、上下文中间件和容量监测；[发行与升级说明](framework/docs/release-0.8.0.md)。

## 在仓库中运行

环境：Node.js **24.21.0**（[.nvmrc](.nvmrc)）、npm **11.19.0**、TypeScript **5.9.3**。

```sh
npm run install:all
npm run check:all
```

- install:all 分别按三个锁文件安装。
- check:all 检查三个工程，不连接 QQ；安装及消费者验证需要 npm registry。

| 根目录命令                | 作用                        |
| ------------------------- | --------------------------- |
| npm run example:check     | 检查业务示例                |
| npm run example:build     | 编译业务示例                |
| npm run example:start     | 启动机器人，连接真实 QQ     |
| npm run example:dev       | 保存后自动重启，连接真实 QQ |
| npm run docs:dev          | 预览文档                    |
| npm run docs:build        | 构建文档                    |
| npm run docs:check        | 检查文档、API、示例和链接   |
| npm run docs:test:browser | 桌面和手机浏览器检查        |

业务凭证放在被 Git 忽略的 `example/.env`。SDK 命令在 `framework/` 中执行：

```sh
cd framework
npm run check
npm run build
npm run example:offline
```

## 参与开发

- [源码开发](framework/docs/contributing.md)
- [仓库与 CI](framework/docs/repository.md)
- [跨设备交接](framework/docs/handoff.md)
- [目录迁移记录](framework/docs/directory-migration-2026-10-11.md)
- [公开 API 审查](framework/docs/api-review-1.0.md)

SDK、示例、网站和技能均采用 [MIT](LICENSE)，上游声明见 [NOTICE](NOTICE)。
