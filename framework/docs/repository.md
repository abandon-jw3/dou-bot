# 统一仓库维护指南

框架、独立业务示例与文档站统一在 [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot) 维护。当前布局由 ad0df74 基线迁移而来，详见 [目录迁移记录](directory-migration-2026-10-11.md)。换设备前先阅读 [跨设备交接](handoff.md)。

## 当前源码与发布版

- 当前源码契约 2.0 尚未发布：AppFactory、多机器人和必选 PostgreSQL。
- 新版本独立设计和验收，使用方式见 [SDK README](../README.md) 与 [多机器人指南](multi-bot.md)。
- 已发布的 npm 0.8.0、业务示例、网站与技能保留各自的发布状态，不作为新 API 的兼容要求。
- PostgreSQL 专项使用 TEST_DATABASE_* 和随机测试 schema；普通离线检查不读取业务数据库配置。

## 三个工程的边界

| 仓库路径   | 职责                                              | 依赖与产物                                                     |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------- |
| framework/ | dou-bot SDK、源码示例、探针、测试、维护文档与技能 | 独立锁文件和 node_modules；dist 为 SDK 产物；唯一 npm 发行目录 |
| example/   | 可独立复制的机器人业务示例，覆盖 30 个装饰器      | 精确安装 npm dou-bot@0.8.0；dist 为应用产物                    |
| website/   | VitePress 用户手册、可运行教程和浏览器验证        | 精确安装 npm dou-bot@0.8.0；产物位于 docs/.vitepress/dist      |

framework/examples 使用当前 SDK 源码进行验证；example 使用已发布包展示业务。framework/docs 保存 SDK 指南及维护记录，framework/skills/dou-bot 是配套技能，website/docs 是面向使用者的站点内容。

三个工程各自安装依赖，没有 npm workspaces、跨工程 node_modules 共享或源码 file: 依赖。根 package.json 名为 dou-bot-repository，private 且没有依赖、SDK 导出或发行钩子；原 SDK 锁文件位于 framework，根目录不需要 npm install 或 npm ci。

## 安装与开发

开发统一使用 Node.js **24.21.0**（仓库根 .nvmrc）、npm **11.19.0** 和 TypeScript **5.9.3**。SDK 支持 >=24.0.0 <25；根操作入口、业务示例与文档工具支持 >=24.21.0 <25。SDK 的 CI 同时检查最低版本和开发版本。已发布 0.6.0 的旧 >=24 元数据保留为历史。

在仓库根目录运行：

```sh
npm run install:all
npm run check:all
npm run example:check
npm run docs:check
npm --prefix website exec -- playwright install chromium
npm run docs:test:browser
```

install:all 分别执行 framework、example 的 npm ci --ignore-scripts 和 website 的 npm ci。check:all 先验证仓库布局、根清单、根 README 链接及共享文件格式，再运行三个工程的完整检查，不连接 QQ。

SDK 的构建、测试、覆盖率、消费者、源码示例、诊断和压测命令在 framework 内执行，根目录不提供 SDK 命令别名：

```sh
cd framework
npm run check
npm run build
npm run example:offline
```

历史发布包可按需使用 `test:history:0.6`、`test:history:0.7`、`test:history:0.8` 单独复验；这些命令不属于新版本检查或发布门槛。

业务示例和网站分别可进入 example、website 后独立运行自己的命令。根目录只保留 install:all、check:all、example:check/build/start/dev 和 docs:dev/build/check/test:browser。后两组通过 npm --prefix 转发参数；SDK 的 pretest、precoverage、prepack 和 prepublishOnly 仅保留在 framework 中。

业务开发使用 npm run example:dev，保存并编译成功后有序重启；错误时保留上次成功版本。正式运行使用 npm run example:build 和 npm run example:start，真实凭证位于 example/.env。源码真实探针通常读取 framework/.env，附件探针明确读取 example/.env；离线示例不读取凭证。迁移保留已有本地环境文件，不将凭证加入版本控制。

## CI 与文档部署

唯一工作流为 [ci.yml](../../.github/workflows/ci.yml)。SDK 在 framework、业务示例在 example、文档站在 website 执行；缓存分别引用对应锁文件，Node 开发版本统一从仓库根 .nvmrc 读取。SDK CI 同时运行仓库级检查，验证根入口不会因只运行子工程检查而失效。

SDK 的 Windows/Linux、最低版/开发版四组矩阵执行完整检查、覆盖率、30 秒持续运行及两小时虚拟容量回归。另设 Linux PostgreSQL 17 服务专项，使用 TEST_DATABASE_* 隔离配置并显式要求专项执行。报告位于 framework/work/soak-latest.json 与 framework/work/capacity-review/ci.json，按平台和 Node 档位分别保存。业务示例、文档工具保留双平台检查；文档另执行依赖审计和 Linux Chromium 浏览器测试。

在 framework 内运行 npm run benchmark:framework -- 5 local 做源码性能对照，npm run soak -- 30000 做短时回归，npm run benchmark:capacity -- virtual 7200000 local 覆盖两小时虚拟时间。虚拟时间不等于真实持续运行；65 分钟真实计时命令见 [容量指南](capacity.md)，仅在具体任务授权时执行。结果写入 framework/work，历史数值按原始指纹与工作负载解释。

混合负载使用 `npm run benchmark:mixed -- smoke local-smoke` 验证测试工具，再运行 `npm run benchmark:mixed -- standard local-standard`。完整场景约 6 分钟，涵盖本机 Webhook 验签、慢 HTTP 业务、过载与恢复；结果位于 framework/work/mixed-benchmark。每次使用不同标签，报告不覆盖已有文件。详见 [混合 Benchmark](benchmark-mixed-2026-10-14.md)。

连接问题可用 `npm run benchmark:mixed -- connections local-connections` 做 70 秒诊断。需要限制客户端连接突发时设置 `DOU_BOT_BENCHMARK_MAX_SOCKETS`；它不改变计划事件速率，报告会记录实际值和客户端等待。实测范围见 [生产准备与连接排查](readiness-2026-10-20.md)。

只有 main 的非 PR 工作流在全部检查成功后部署 Pages，产物仍为 website/docs/.vitepress/dist。线上地址为 [abandon-jw3.github.io/dou-bot/](https://abandon-jw3.github.io/dou-bot/)，base 为 /dou-bot/，页面编辑链接仍指向 website/docs/:path。原 /dou-bot-docs/ 的站点跳转保持；这与本次不保留旧仓库目录是两种不同的路径。

## npm 发布与文档版本

只从 framework 目录构建、打包和发布 dou-bot。repository.directory 标记为 framework；发布入口仍为 dou-bot 和 dou-bot/testing，包内结构仍是 dist、README、许可和白名单指南，没有额外的 framework 外层目录。

SDK 0.8.0 已发布，对应契约为 1.14；当前未发布源码契约为 2.0。example、website 和技能已同步使用 npm 0.8.0。发行范围及候选验收见 [0.8.0 说明](release-0.8.0.md)。

README 和公开指南随 SDK 发包，相对链接必须落在安装包内；仓库维护材料和其他工程使用完整 GitHub 链接。npm run test:package 验证 tarball、文档链接、凭证排除与独立消费者。历史验收 JSON 原文保留，不为了消除旧路径而改写原始证据。

后续正式发布目标 SDK 后，再同步 example/vendor/sdk.json、两个消费者的精确依赖与锁文件、网站版本/API 索引和技能。站点维护细节见 [website/README.md](../../website/README.md)。

## 历史与许可

两个子项目通过未压缩的 Git subtree 合并导入，保留原始提交作为合并祖先。迁移基线为示例 `2dbe39698360c1a1cfccc8b074e16cecd85f3b80` 与文档 `38563f89346b55fbd4b4e9b1f7632b322e917bd2`；可以用 `git show <commit>` 查阅迁移前内容。

2026-10-01，所有者明确将 SDK、独立业务示例、文档及配套技能统一以 MIT 授权。根目录保留统一 `LICENSE`；SDK、业务示例和文档分别保留 `framework/LICENSE`、`example/LICENSE`、`website/LICENSE`，便于独立复制分发。根目录和业务示例的 `NOTICE` 继续保留 SDK 与适用上游声明；依赖包保留各自的许可证。

## 文档工具依赖维护

2026-09-30 的 `npm audit` 对沿用的 VitePress 1.6.4 工具依赖报告 3 项问题（1 项 high、2 项 moderate），涉及 Vite、esbuild 及 VitePress 的依赖关系，当时没有自动修复方案。

2026-10-01 评估后保留 VitePress **1.6.4** 与默认主题，在 `website/package.json` 中仅对它的 Vite 依赖设置精确 override **6.4.3**，锁文件将 esbuild 更新为 **0.25.12**。VitePress 稳定版仍为 1.6.4，下一版为 2.0.0-alpha.20；本轮采用已修复问题的稳定 Vite 6，而非更换文档框架。现有 `@vitejs/plugin-vue@5.2.4` 的 peer 范围包含 Vite 6，安装依赖树无冲突。

该 override 超出 VitePress 原先声明的 Vite 5 范围，是本仓库维护的兼容组合。已核对 [Vite 6 迁移说明](https://github.com/vitejs/vite/blob/v6.4.3/docs/guide/migration.md) 和 [Vite 官方修复公告](https://github.com/vitejs/vite/security/advisories/GHSA-fx2h-pf6j-xcff)；当前站点没有自定义 Sass、PostCSS 配置或条件解析。本轮已通过文档类型检查、发布包 API 索引、14 项示例测试、生产构建、12 项生产预览浏览器测试，以及开发服务器桌面/手机渲染、导航、搜索、刷新和控制台检查。后续升级应重复这些验收。

本次 `npm audit` 已降为 **0 项告警**。CI 增加 `npm audit --audit-level=moderate`；后续 VitePress 稳定版正式采用已修复的 Vite 后，移除 override 并重新验收。工具依赖只安装在 `website` 工程，SDK 发包检查继续拒绝携带它们。

2026-10-06 部署补充：`a8fbeb7` 的四组 SDK 和两组业务示例 CI 通过，文档任务被 source-map-js 的 [安全公告](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) 阻断。仅将网站锁文件中的传递依赖 source-map-js 从 1.2.1 更新到上游 [1.2.2 修复版本](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2)，现有依赖范围已兼容，无需新增 override 或调整直接依赖。干净安装后 audit 恢复为 0 项告警，文档完整检查和 12 项浏览器测试通过；VitePress、TypeScript 与 SDK 版本保持。

## 本机双机器人验收

当前源码使用 `npm run probe:multi-bot`，配置仅取 framework/.env。先运行 `--check` 和显式 `--migrate`，再启动双 WS；完整步骤见 [验收指南](live-multi-bot.md)。旧的本机 TEST_DATABASE_* 不再使用。

2026-10-20 已完成真实双 WS 收发、主动群消息、群地址持久化和单账号停止/恢复验证，见 [实测记录](live-multi-bot-2026-10-20.md)。两个验收实例已关闭。
