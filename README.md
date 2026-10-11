# dou-bot

面向 QQ 官方机器人群聊和私聊的轻量 TypeScript 装饰器框架，支持 WS 与 Webhook。

[在线用户文档](https://abandon-jw3.github.io/dou-bot/) · [SDK 安装与使用](framework/README.md) · [业务示例](example/README.md)

## 三个独立工程

| 目录                              | 用途                                                         | 依赖边界                                   |
| --------------------------------- | ------------------------------------------------------------ | ------------------------------------------ |
| [framework/](framework/README.md) | SDK 源码、测试、源码演示、协议探针、压测、维护文档与配套技能 | npm 包名 dou-bot；只从此目录构建和发布 SDK |
| [example/](example/README.md)     | 可单独复制运行的业务示例，包含命令、附件、权限和交互演示     | 独立安装已发布的 dou-bot@0.7.0             |
| [website/](website/README.md)     | 中文文档站、可运行教程和浏览器测试                           | 独立安装已发布的 dou-bot@0.7.0             |

三个工程各自维护 package.json、package-lock.json 和 node_modules，没有 npm workspaces 或源码依赖链接。根 package.json 是无依赖的 private 操作入口，不提供 SDK 导出；根目录不需要运行 npm install 或 npm ci。

SDK 当前版本号为 0.7.0，源码契约为 1.14，包含尚未发布的 Slot.normalize、上下文中间件与容量监测。示例、网站和技能继续使用 npm 0.7.0 的公开 API。

## 安装与检查

仓库开发使用 Node.js **24.21.0**（见 [.nvmrc](.nvmrc)）、npm **11.19.0** 和 TypeScript **5.9.3**。SDK 最低支持 Node 24.0.0；根操作入口、业务示例和文档工具使用 24.21.0 或受支持的后续 24.x。

在仓库根目录执行：

```sh
npm run install:all
npm run check:all
```

install:all 按三个锁文件分别安装；check:all 校验仓库布局、共享文件和根文档链接，然后运行三个工程的完整检查。它不连接 QQ；依赖安装和消费者验证需要访问 npm registry。

| 根目录命令                | 用途                                     |
| ------------------------- | ---------------------------------------- |
| npm run example:check     | 业务示例完整离线检查                     |
| npm run example:build     | 编译业务示例                             |
| npm run example:start     | 启动业务示例，会连接真实 QQ              |
| npm run example:dev       | 保存后自动重启业务示例，会连接真实 QQ    |
| npm run docs:dev          | 启动本地文档开发服务器                   |
| npm run docs:build        | 构建文档站                               |
| npm run docs:check        | 文档类型、示例、API 索引、链接及构建检查 |
| npm run docs:test:browser | 文档站桌面和手机浏览器验证               |

业务凭证只在本地的 example/.env 配置，始终被 Git 忽略。源码探针的配置与权限边界见 [源码开发与联调](framework/docs/contributing.md)。

SDK 的构建、单元测试、覆盖率、消费者、探针和压测命令在框架目录运行：

```sh
cd framework
npm run check
npm run build
npm run example:offline
```

根目录不再提供这些 SDK 命令的转发。framework/examples 是源码验证工具，example 是使用已发布 SDK 的独立业务工程。

## 维护与交接

- [跨设备开发交接](framework/docs/handoff.md)
- [仓库维护与 CI](framework/docs/repository.md)
- [目录迁移记录](framework/docs/directory-migration-2026-10-11.md)
- [公开 API 审查](framework/docs/api-review-1.0.md)
- [容量配置与运行监测](framework/docs/capacity.md)
- [dou-bot 技能](framework/skills/dou-bot/SKILL.md)

文档站的地址与 /dou-bot/ base 保持不变。目录迁移不保留旧路径占位；已发布版本 README 中的旧 GitHub 路径可能失效，历史内容可按对应提交查阅。

SDK、业务示例、网站和技能均采用 [MIT](LICENSE)，上游许可说明见 [NOTICE](NOTICE)。
