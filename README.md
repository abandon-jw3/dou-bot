# dou-bot

面向 QQ 官方群聊和私聊的轻量 TypeScript 机器人框架，支持 WebSocket 与 Webhook。

> 当前版本：**1.0.0**。业务示例和文档站均使用同版本的独立安装包。

## 开始使用

- [在线用户文档](https://abandon-jw3.github.io/dou-bot/)：安装、功能指南和 API。
- [SDK 安装与使用](framework/README.md)：功能总览与离线测试入口。
- [业务示例](example/README.md)：复制后即可开发，包含命令、附件、权限和对话。
- [dou-bot 技能](framework/skills/dou-bot/SKILL.md)：辅助编写机器人业务。

## 项目目录

| 目录                              | 用途                                     |
| --------------------------------- | ---------------------------------------- |
| [framework/](framework/README.md) | SDK、源码示例、测试和配套技能            |
| [example/](example/README.md)     | 独立业务项目，安装 1.0.0 独立 SDK 快照包 |
| [website/](website/README.md)     | VitePress 用户文档与可运行教程           |

- 三个工程独立安装依赖，没有 workspaces 或源码链接。
- 根 package.json 仅提供跨工程命令，无需在根目录执行 npm install。

## 在仓库中运行

环境：Node.js **24.21.0**（[.nvmrc](.nvmrc)）、npm **11.19.0**、TypeScript **5.9.3**。

```sh
npm run install:all
npm run check:all
```

- `install:all` 分别按三个锁文件安装。
- `check:all` 检查三个工程，不连接 QQ。

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
- [发布流程](framework/docs/npm-release.md)

SDK、示例、网站和技能均采用 [MIT](LICENSE)，上游声明见 [NOTICE](NOTICE)。
