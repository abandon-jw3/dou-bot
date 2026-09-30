# 统一仓库维护指南

框架、独立业务示例和用户文档站统一在 [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot) 维护。原 `dou-bot-example` 与 `dou-bot-docs` 仓库只保留历史和迁移入口。

换设备或交给新的开发对话时，先阅读 [跨设备开发交接](handoff.md)，按其中步骤恢复环境并核对当前状态。

## 三个工程的边界

| 目录            | 职责                                                 | 依赖与产物                                                              |
| --------------- | ---------------------------------------------------- | ----------------------------------------------------------------------- |
| 根目录          | `dou-bot` SDK 源码、协议测试和 npm 发布              | 根锁文件；产物 `dist/`；只有此工程可以发布到 npm                        |
| `apps/example/` | 可独立复制使用的机器人初始项目，覆盖 20 个装饰器     | 自己的锁文件；安装 npm 的 `dou-bot@0.6.0`；产物 `dist/`                 |
| `website/`      | VitePress 1.6.4 用户手册、可运行文档示例、浏览器测试 | 自己的锁文件；安装 npm 的 `dou-bot@0.6.0`；产物 `docs/.vitepress/dist/` |

根目录的 `examples/` 是 SDK 源码开发时使用的协议探针、离线示例和持续运行测试。`docs/` 保存 SDK 指南与维护记录；面向用户的网站内容位于 `website/docs/`。

这里采用单仓库、独立 npm 工程，没有开启 npm workspaces。这样示例和文档始终验证真正发布到 registry 的版本，不会自动链接到含有未发布接口的 SDK 源码。三个锁文件都必须提交；不要在跨工程之间共享 `node_modules` 或使用指向根目录的 SDK `file:` 依赖。

## 安装与开发

统一使用 Node.js **24.21.0**、npm **11.19.0**、TypeScript **5.9.3**。根目录 `.nvmrc` 声明开发用 Node 版本，三个工程的开发版本 CI 统一读取此文件。使用 nvm 时，可在仓库根目录执行 `nvm install` 和 `nvm use` 安装并切换到该版本。

当前源码正式支持 Node.js **24.x**：SDK 的 `engines.node` 为 `>=24.0.0 <25`；业务示例与文档工具工程为 `>=24.21.0 <25`。SDK 的最低版本 24.0.0 用于兼容性验证，日常开发与部署使用 24.21.0 或后续 24.x 安全补丁。其他主版本需单独验证后再扩展范围，不能根据旧的 `>=24` 声明推定已经支持。

已发布的 `dou-bot@0.6.0` 仍保留原来的 `>=24` 元数据；本轮增加的 `<25` 上界只会随新 SDK 版本发布。网站面向 0.6.0 的安装说明继续描述已发布包，后续发行同步调整。

在主仓库根目录运行：

```sh
npm run install:all
npm run check:all
```

`install:all` 对三个工程分别执行 `npm ci`。`check:all` 依次检查 SDK、业务示例与文档，不连接 QQ。只修改某一部分时，可以单独执行相应检查：

```sh
npm run check                # SDK，包括类型、API、打包消费者和单元测试
npm run example:check        # 独立业务示例
npm run docs:check           # 文档类型、示例、API 索引、链接及生产构建
npm --prefix website exec -- playwright install chromium
npm run docs:test:browser    # 桌面和手机浏览器验收，自动启动本地预览
```

文档开发使用 `npm run docs:dev`。业务示例使用 `npm run example:build` 和 `npm run example:start`；真实凭证只填入 `apps/example/.env`。原目录中的 `.env` 不会因 Git 合并自动迁入，请按需自行配置，勿提交真实凭证。

各子工程也支持先 `cd apps/example` 或 `cd website`，再使用各自 README 中的命令。业务示例代码与依赖可独立复制；其中涉及仓库 CI 的说明仍指向本仓库。

## CI 与文档部署

唯一工作流为 [ci.yml](../.github/workflows/ci.yml)。每次提交或 PR 分别在 Windows 和 Linux 上检查三个工程；SDK 对最低版本 24.0.0 和 `.nvmrc` 开发版本分别执行完整检查、覆盖率和 30 秒持续运行检查。持续运行报告按系统与版本档位分别命名。业务示例、文档工具使用开发版本；文档同时执行依赖审计和 Linux Chromium 浏览器测试。

只有 `main` 的非 PR 工作流在全部检查成功后部署 Pages。部署产物为 `website/docs/.vitepress/dist`，Pages Source 使用 GitHub Actions，环境为 `github-pages`。

文档正式地址为 [abandon-jw3.github.io/dou-bot/](https://abandon-jw3.github.io/dou-bot/)，`base` 固定为 `/dou-bot/`。编辑链接指向 `website/docs/:path`，问题反馈统一到主仓库 Issues。原 `/dou-bot-docs/` 下已有页面保留跳转，并保留路径、查询参数和页内锚点。

修改站点路径时同步检查 `website/docs/.vitepress/config.ts`、`website/playwright.config.ts`、产物链接检查脚本及浏览器断言。线上复验可在 `website` 工程设置 `DOCS_ORIGIN=https://abandon-jw3.github.io` 后运行 `npm run test:browser`。

## npm 发布与文档版本

仍只从主仓库根目录发布 `dou-bot`。SDK 的 `files` 白名单不包含 `apps/` 或 `website/`，`npm run test:package` 会检查实际 tarball，避免将网站工具与示例打入运行时包。

示例和文档工程保留 `"private": true`，防止误发布；与 GitHub 仓库公开状态无关。本次整合不修改 SDK 版本，也不执行 npm 发布。

升级文档及示例的 SDK 时，先发布目标 SDK，再同步两处精确依赖、锁文件、`apps/example/vendor/sdk.json`、文档版本标识与 API 索引，最后运行完整检查。网站的具体维护步骤见 [website/README.md](../website/README.md)。

## 历史与许可

两个子项目通过未压缩的 Git subtree 合并导入，保留原始提交作为合并祖先。迁移基线为示例 `2dbe39698360c1a1cfccc8b074e16cecd85f3b80` 与文档 `38563f89346b55fbd4b4e9b1f7632b322e917bd2`；可以用 `git show <commit>` 查阅迁移前内容。

各工程许可沿用原状：SDK 的 MIT 与上游声明见根目录 `LICENSE`、`NOTICE`；文档与其中新编写的示例使用 `website/LICENSE`；独立业务示例自身的许可范围见 `apps/example/NOTICE`，此次迁移不重新授权其代码。

## 文档工具依赖维护

2026-09-30 的 `npm audit` 对沿用的 VitePress 1.6.4 工具依赖报告 3 项问题（1 项 high、2 项 moderate），涉及 Vite、esbuild 及 VitePress 的依赖关系，当时没有自动修复方案。

2026-10-01 评估后保留 VitePress **1.6.4** 与默认主题，在 `website/package.json` 中仅对它的 Vite 依赖设置精确 override **6.4.3**，锁文件将 esbuild 更新为 **0.25.12**。VitePress 稳定版仍为 1.6.4，下一版为 2.0.0-alpha.20；本轮采用已修复问题的稳定 Vite 6，而非更换文档框架。现有 `@vitejs/plugin-vue@5.2.4` 的 peer 范围包含 Vite 6，安装依赖树无冲突。

该 override 超出 VitePress 原先声明的 Vite 5 范围，是本仓库维护的兼容组合。已核对 [Vite 6 迁移说明](https://github.com/vitejs/vite/blob/v6.4.3/docs/guide/migration.md) 和 [Vite 官方修复公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)；当前站点没有自定义 Sass、PostCSS 配置或条件解析。本轮已通过文档类型检查、发布包 API 索引、14 项示例测试、生产构建、12 项生产预览浏览器测试，以及开发服务器桌面/手机渲染、导航、搜索、刷新和控制台检查。后续升级应重复这些验收。

本次 `npm audit` 已降为 **0 项告警**。CI 增加 `npm audit --audit-level=moderate`；后续 VitePress 稳定版正式采用已修复的 Vite 后，移除 override 并重新验收。工具依赖只安装在 `website` 工程，SDK 发包检查继续拒绝携带它们。
