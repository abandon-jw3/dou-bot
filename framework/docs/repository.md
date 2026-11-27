# 统一仓库维护指南

框架与文档站统一在 [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot) 维护。

## 两个工程的边界

| 仓库路径   | 职责                                              | 依赖与产物                                                     |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------- |
| framework/ | dou-bot SDK、源码示例、探针、测试、维护文档与技能 | 独立锁文件和 node_modules；dist 为 SDK 产物；唯一 npm 发行目录 |
| website/   | VitePress 用户手册、可运行教程和浏览器验证        | 独立安装 SDK 包；产物位于 docs/.vitepress/dist                 |

- `framework/examples` 使用当前 SDK 源码进行验证；`website` 安装独立的打包产物，不使用 npm workspaces、跨工程 `node_modules` 共享或源码路径链接。
- 根 `package.json` 名为 `dou-bot-repository`，`private: true`，仅提供跨工程脚本，根目录不需要 `npm install`。

## 安装与开发

开发统一使用 Node.js **24.21.0**（仓库根 `.nvmrc`）、npm **11.19.0** 和 TypeScript **5.9.3**。SDK 支持 `>=24.0.0 <25`；根操作入口与文档工具支持 `>=24.21.0 <25`。

在仓库根目录运行：

```sh
npm run install:all
npm run check:all
npm run docs:check
npm --prefix website exec -- playwright install chromium
npm run docs:test:browser
```

- `install:all` 分别执行 `framework` 的 `npm ci --ignore-scripts` 和 `website` 的 `npm ci`。
- `check:all` 先验证仓库布局、根清单、根 README 链接及共享文件格式，再运行两个工程的完整检查，不连接 QQ。

SDK 的构建、测试、覆盖率、消费者、源码示例、诊断和压测命令在 `framework/` 内执行：

```sh
cd framework
npm run check
npm run build
npm run example:offline
```

## CI 与文档部署

唯一工作流为 [ci.yml](../../.github/workflows/ci.yml)：

- SDK 在 Windows/Linux 与 Node 24.0.0 / `.nvmrc` 矩阵上执行完整检查、覆盖率、两小时虚拟容量回归和 30 秒持续负载回归。
- PostgreSQL 集成测试在独立 PostgreSQL 17 服务上运行，使用 `TEST_DATABASE_*` 和随机 schema。
- 文档站在双平台运行检查，另执行 `npm audit --audit-level=moderate` 与 Linux Chromium 浏览器测试。
- 仅 `main` 分支的非 PR 工作流在全部检查成功后部署 GitHub Pages，线上地址为 [abandon-jw3.github.io/dou-bot/](https://abandon-jw3.github.io/dou-bot/)（`base: '/dou-bot/'`）。

## SDK 同步与发布

- 只从 `framework/` 目录构建、打包和发布 `dou-bot`，详细步骤见 [npm 发布流程](npm-release.md)。
- 在发布到 npm 前同步当前源码到 `website/` 时，在 `framework/` 执行 `node scripts/prepare-user-sdk.mjs`，再在 `website/` 执行 `npm install --save-exact --save-dev --ignore-scripts ./vendor/dou-bot-source.tgz`，随后在 `website/` 执行 `npm run api:generate` 更新 API 索引并运行全量检查。
- 正式发布到 npm registry 后，将文档站切换为精确的 registry 版本并同步 `vendor/sdk.json`。
- 站点维护细节见 [website/README.md](../../website/README.md)。

## 文档工具依赖维护

- `website/` 使用 VitePress **1.6.4**，并在 `website/package.json` 中对 VitePress 内部依赖显式固定 `vite` 为 **6.4.5**（处理上游 Vite/launch-editor 安全告警），使 `npm audit --audit-level=moderate` 保持 0 告警。
- 工具依赖仅安装在 `website/` 工程内，SDK 发包检查会拒绝携带任何开发或文档依赖。
- 后续 VitePress 稳定版原生升级到包含修复的 Vite 后，可移除该 `overrides` 并重新运行文档检查与浏览器测试。

## 许可证

SDK、文档及配套技能统一以 MIT 授权。根目录与两个子工程各自保留 `LICENSE` 与 `NOTICE`，便于独立复制分发。
