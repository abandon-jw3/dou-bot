# dou-bot 跨设备开发交接

交接日期：2026-09-30（Asia/Shanghai）。状态基于功能提交 `03e1f7f6588368a1beddd447f0d0b6fc06107ffd`；本交接文档会作为后续提交进入同一仓库。新设备应拉取 `main` 最新内容，接手时再用 `git log` 和 CI 核对实际版本。

维护更新：2026-10-01。文档、Node 支持范围和文档工具依赖的收尾已作为 `ada385b7bdec991087e4dbfa00a3b6bebc5db1b8` 推送，Windows/Linux 全部 9 项 CI（含文档部署）通过；尚未发布新的 SDK。随后所有者明确统一采用 MIT，并授权开始 WS 与分角色实测。

实测更新：2026-10-06。基于 `20706f1` 的业务示例完成新设备 WS 私聊/群聊文字、原始 Markdown 及普通按钮的收发和客户端确认。随后独立的角色探针完成群主、管理员、普通成员的角色命令与管理者回调按钮验收；两轮测试连接均已关闭。结论限于本次机器人和测试会话，详见 [验收记录](validation-report.md#2026-10-06-分角色权限与管理者按钮实测)。

附件 API 更新：2026-10-06。源码新增 Attachments、Images、Videos、Audios、Files 和 AttachmentOptions，并映射语音 WAV URL 与 ASR 参考文本；该次公开契约修订为 1.8，尚未发布。实现与验证入口见 [附件参数指南](command-parameters.md#附件参数)。业务示例、网站和技能仍面向 npm 0.6.0。

附件离线验收已通过：Node 24.0.0 / 24.21.0 各 199 项 SDK 测试，129 个导出与 96 组类型检查；当前 tarball、新功能消费者、历史 0.6.0 消费者及整仓检查均通过。真实 QQ 附件投递单独记录，详见 [附件验收记录](attachment-validation-2026-10-06.json)。

本轮附件实测已结束：群聊收到 1 个 `image/jpeg` 附件、筛选成功并完成回复发送；用户明确无需继续验证其他附件类型。视频、音频、文件、混合附件及私聊未完成实机验收，保留离线检查结果。已确认探针不再运行，退出记录的限制见上述验收记录。

身份 API 更新：2026-10-06。源码新增 User、UserId、Group、GroupId、Role 和 UserInfo / GroupInfo，公开契约更新为 1.9，尚未发布。命令与按钮从当前事件的冻结快照注入信息，缺失群或角色时为 undefined；Context 接口及生产依赖不变。运行 `npm run example:identity` 查看离线示例，规则见 [身份参数指南](command-parameters.md#身份参数)。本轮只做离线与本地协议验收，没有启动真实 QQ 联调。

身份离线验收已通过：Node 24.0.0 / 24.21.0 各 213 项 SDK 测试（其中身份专项 14 项），136 个导出与 98 组类型检查；当前 tarball、历史 0.6.0 消费者、整仓检查及本地 WS/Webhook 对照均通过。覆盖率为行/语句 98.69%、函数 97.72%、分支 90.32%；来源与范围见 [身份验收记录](identity-validation-2026-10-06.json)。

文档站更新：2026-10-06。首页、指南、API 和五个完整示例已改为使用者叙事，示例按业务项目的 src 目录说明操作；维护约定放在 website/README.md。文档完整检查、14 项示例测试、五个独立项目编译和 12 项桌面/手机浏览器测试通过，仍使用 npm 0.6.0。

交付：所有者已要求将附件、身份和文档站改动一并提交并部署。推送 main 后由 CI 检查并部署 GitHub Pages；本次不修改 SDK 版本或发布 npm。测试记录中的 dirty 和源码指纹保留采集时的状态，部署结果按 main 最新提交对应的工作流核对。

首次交付提交为 `a8fbeb7`；其 SDK 与业务示例 CI 通过，文档审计被 source-map-js 1.2.1 的安全公告阻断。部署修复只将网站锁文件中的该传递依赖更新为 1.2.2，干净安装、audit、文档检查和 12 项浏览器测试均通过；详见 [文档工具依赖维护](repository.md#文档工具依赖维护)。

附件交互收敛：2026-10-06。用户反馈当前客户端仅能将图片与文字同条发送，视频、音频和文件需要单独发送。当前源码契约改为 1.10，保留 Attachments / Images，移除未发布的 Videos / Audios / Files，新增 selectAttachments 与三种相关类型。后续附件由业务明确 prompt 后筛选，普通不匹配返回 invalid，不自动等待、重试或累计。源码示例和探针已采用对应流程；本轮不启动真实 QQ、不提交、推送或部署。

收敛后的离线检查已通过：两版 Node 各 222 项 SDK 测试、137 个导出、101 组类型检查，以及整仓、覆盖率、当前 tarball 和历史消费者检查。附件模块行、函数和分支覆盖率为 100%；分条输入的本地 WS/Webhook 对照通过。客户端观察与机器人投递能力分别记录，详见 [附件输入验收记录](attachment-input-validation-2026-10-06.json)。此前 1.8 / 1.9 的记录保留原始证据。

自动附件路由更新：2026-10-06。契约 1.11 新增 OnAttachment / OnAttachmentOptions，按文件名、扩展名、分类监听直接上传。pending prompt、已识别命令优先；多个匹配处理器独立授权和顺序执行，允许 await prompt 后再继续下一个。处理器各自收尾 Context、发送和未等待的追问，整条消息共享去重、操作预算与回复序号。GuardContext.kind 增加 attachment 分支，旧穷尽判断需要迁移。用法见 [自动附件指南](command-parameters.md#自动处理上传附件)。本轮仅离线及本地协议验收，未提交、推送或部署。

自动附件离线验收通过：两版 Node 各 242 项 SDK 测试（路由专项 20 项）、139 个导出、102 组类型检查；整仓、当前 tarball、历史 npm 0.6.0 消费者和本地 WS/Webhook 对照通过。整体行覆盖率 98.78%，附件分类与路由模块行、函数、分支均为 100%。源码指纹与边界见 [自动附件验收记录](attachment-route-validation-2026-10-06.json)；真实 QQ 直接文件投递仍待另行验收。

0.7.0 发行准备：2026-10-06。根包和锁文件版本已设为 0.7.0，公开契约为 1.11，计划公开发布到 npm 的 latest 标签。当前仍处于候选准备阶段；npm 已发布版本、业务示例、网站和技能仍为 0.6.0，实际上传后再同步升级。变更、迁移、候选完整性和发布后清单见 [发行流程](npm-release.md#070-发行候选)。

## 1. 接手时先确认的状态

| 项目            | 当前状态                                                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 唯一开发仓库    | [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot)，公开，默认分支 `main`                                                 |
| 用户文档        | [abandon-jw3.github.io/dou-bot/](https://abandon-jw3.github.io/dou-bot/)                                                             |
| 已发布 npm 版本 | `dou-bot@0.6.0`；交接时查询到 `latest`、`next` 都指向 `0.6.0`                                                                        |
| 源码状态        | 0.7.0 候选已验收；契约 1.11，npm 实际上传尚未执行                                                                                    |
| 业务示例        | 已并入 `apps/example/`，精确依赖 npm 的 `dou-bot@0.6.0`                                                                              |
| 文档站          | 已并入 `website/`，示例和 API 索引也精确依赖 npm 的 `dou-bot@0.6.0`                                                                  |
| 配套技能        | 仓库位置 `skills/dou-bot/`，名称及调用名为 `$dou-bot`                                                                                |
| 已提交 CI 基线  | [b7f3808 对应工作流](https://github.com/abandon-jw3/dou-bot/actions/runs/37408996480) 的 9 项任务通过；本轮 1.10 / 1.11 调整尚未提交 |
| 真实 QQ 服务    | 2026-10-06 基础 WS 收发及本次测试群的三角色权限验收已通过；两轮连接均已关闭                                                          |

**源码与 npm 包存在差异。** 根目录 `package.json` 已标为待发布的 `0.7.0`，源码已新增 testing 入口的 `TestAdmission`、Attachments / Images、`AttachmentOptions`、selectAttachments 及相关类型、语音附件扩展字段，以及五种身份参数装饰器和 UserInfo / GroupInfo、OnAttachment / OnAttachmentOptions；这些新增 API 不在已发布的 0.6.0 中。业务示例和网站继续验证发布包；判断源码状态要看提交号和类型声明，不能只看版本字段。

源码的 Node 声明已限定为 `>=24.0.0 <25`；已发布 0.6.0 仍为 `>=24`。后续发行需要明确说明此安装范围收紧，不能把它记成已发布包的既有要求。

原 `dou-bot-example`、`dou-bot-docs` 仓库已归档，保留历史和迁移入口。两个项目通过未压缩的 Git subtree 导入，原提交历史仍可查阅。旧文档地址 `/dou-bot-docs/` 保留跳转，路径、查询参数和锚点会转到新站。后续代码、Issue 和文档更新统一在主仓库进行。

## 2. 已确定的项目方向

- 仅支持 QQ 官方机器人的群聊和私聊，提供 WS 与 Webhook 两种接入。
- 保持轻量；SDK 生产直接依赖只有 `reflect-metadata@0.2.2` 和 `ws@8.22.0`。
- 使用 ESM、传统 TypeScript 装饰器及元数据，TypeScript 固定为 **5.9.3**。
- 已决定不做 Koishi/Satori 兼容层、其他平台适配或热更新系统。
- 消息采用文本、图片、原始 Markdown 和内联键盘；当前不采用模板 ID 方式。
- 新手可以复制独立业务示例开发；文档与示例必须能在公开 npm 包上独立运行。
- 首版以 Windows 实机验收为主；Linux 已有自动化 CI 验证，但这不等于 Linux QQ 生产部署实测。

QQ 协议实现曾参考 `@satorijs/adapter-qq` 并结合账号实测。遇到官方文档与实际投递不一致时，需要同时核对实现和实测证据。原设备上的 Satori 下载目录不属于构建依赖，新设备无需复制它才能开发本仓库。

## 3. 新设备从零恢复开发环境

先安装 Git 和 Node.js **24.21.0**。本项目目前使用 npm **11.19.0**，三个工程都有独立锁文件。

根目录 `.nvmrc` 固定开发版本。源码支持 Node 24.x：SDK 最低为 24.0.0，业务示例和文档工具最低为 24.21.0；SDK 的 CI 同时验证最低版本与开发版本，其他两工程读取 `.nvmrc`。使用 nvm 时可在根目录执行 `nvm install` 和 `nvm use`。

下面的命令在 PowerShell、Bash 等常见终端均可执行：

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot
node --version
npm install --global npm@11.19.0
npm --version
git status --short
git log -1 --oneline
npm run install:all
npm run check:all
npm --prefix website exec -- playwright install chromium
npm run docs:test:browser
```

预期 Node/npm 版本分别为 `v24.21.0`、`11.19.0`；刚克隆的工作区应无改动。Linux 环境如果缺少浏览器系统库，将浏览器安装命令改为 `npm --prefix website exec -- playwright install --with-deps chromium`。

这些检查不连接 QQ，也不需要机器人凭证。依赖安装和独立包消费者验证仍需要访问 npm registry。公开仓库克隆和公开 npm 包安装无需沿用旧设备登录态；提交、推送及后续 npm 发布所需的 Git 身份与认证，应在新设备单独配置。网络代理也按新设备环境设置。

`check:all` 会编译 SDK、业务示例和文档站。浏览器测试使用构建后的站点，默认自动启动 `127.0.0.1:4173` 预览；本地验收时保持 `DOCS_ORIGIN` 未设置。Playwright 的 Chromium 需要在新设备安装，不能仅复制 `node_modules`。

### 三个工程的边界

| 位置                    | 开发用途                                       | 独立检查                            |
| ----------------------- | ---------------------------------------------- | ----------------------------------- |
| 根目录 `src/`、`tests/` | 修改 SDK、协议实现与公开 API                   | `npm run check`                     |
| `apps/example/`         | 开发使用发布版 SDK 的机器人业务                | `npm run example:check`             |
| `website/`              | 修改用户手册、可运行文档示例及网站             | `npm run docs:check`                |
| 根目录 `examples/`      | SDK 源码示例、真实 QQ 探针、性能与持续运行工具 | 按对应示例命令运行                  |
| `docs/`                 | 设计、审查、发布、验收及维护记录               | `npm run test:docs`                 |
| `skills/dou-bot/`       | 配套技能及可复制的最小模块                     | 技能示例纳入 `npm run test:package` |

本仓库没有启用 npm workspaces。三个工程独立安装依赖，以确保示例和文档使用真正发布到 npm 的版本。不要为了让未发布 API 在示例里编译成功，直接把它们改成导入根目录源码。

完整目录说明见 [README](../README.md)，维护流程见 [repository.md](repository.md)。

### 常用命令与前置条件

| 命令（主仓库根目录执行）      | 用途与前置条件                                                              |
| ----------------------------- | --------------------------------------------------------------------------- |
| `npm run check:all`           | SDK、业务示例、文档的完整本地检查，不包含浏览器测试                         |
| `npm run test:api`            | 两个公开入口的导出集合与类型契约检查                                        |
| `npm run test:package`        | 验证当前源码 tarball 和技能示例；先运行 `npm run build`                     |
| `npm run test:compat`         | 从 registry 安装已发布的 0.6.0，验证历史消费者；先完成 build/check          |
| `npm run coverage`            | SDK 测试及覆盖率报告                                                        |
| `npm run docs:dev`            | 启动本地文档开发服务器，按终端输出访问 `/dou-bot/`                          |
| `npm run docs:test:browser`   | 桌面和手机浏览器检查；先构建站点并安装 Chromium                             |
| `npm run example:build`       | 编译独立业务示例                                                            |
| `npm run example:attachments` | 离线运行当前源码的附件参数示例，不读取 QQ 凭证                              |
| `npm run example:identity`    | 离线运行当前源码的身份参数示例，覆盖命令及按钮                              |
| `npm run probe:attachments`   | 真实 WS 附件探针，读取 `apps/example/.env`，使用当前 SDK 源码，最长 15 分钟 |
| `npm run example:start`       | 建立真实 QQ WS 连接；先配置示例 `.env` 并完成构建                           |

如只编辑 Markdown，通常只需要相应的格式、链接或站点构建检查；业务或框架变更再运行相关行为测试。不要把单纯文档编辑误当作已重新完成全部实机验收。

## 4. 凭证和真实联调如何接续

真实 AppID、AppSecret、用户及群标识没有写入这份文档。`.env` 被 Git 忽略，克隆仓库不会获得旧设备的凭证；请在新设备本地填写或通过你自己的安全方式迁移。

| 配置位置            | 对应入口                                               |
| ------------------- | ------------------------------------------------------ |
| `apps/example/.env` | `npm run example:start`，当前示例固定使用 WS           |
| 根目录 `.env`       | 框架的 `diagnose:*`、`probe:*`、真实 QQ 示例入口       |
| `website/.env`      | 手动运行文档中的真实连接示例；平常构建与离线测试不需要 |

需要运行独立业务示例时，可在主仓库根目录用 PowerShell 创建初始配置，已有配置不会被覆盖：

```powershell
if (-not (Test-Path -LiteralPath 'apps/example/.env')) {
  Copy-Item -LiteralPath 'apps/example/.env.example' -Destination 'apps/example/.env'
}
```

自行编辑该文件，替换占位值：

```dotenv
QQ_APP_ID=YOUR_APP_ID
QQ_APP_SECRET=YOUR_APP_SECRET
```

完成配置并确认旧设备没有同一个机器人的运行实例后，再按实际联调任务启动：

```sh
npm run example:build
npm run example:start
```

可以先私聊发送 `/hello`，再在测试群验证。群聊不带 `@` 是否可用取决于 QQ 对该账号的投递能力；本框架不会要求所有命令必须以 `/` 开头，前缀可以配置为空。结束测试按 `Ctrl+C` 关闭连接。

当前没有已配置的公网 HTTPS Webhook 测试入口。此前已决定先完成本地验证并记录公网待验项；新设备上不要把这一项误记为已通过。根目录的协议诊断和实机探针说明见 [contributing.md](contributing.md)。

队列、去重、冷却和 prompt 等是进程内状态，不会在重启或换机后延续；多轮对话需要重新开始。

## 5. 在新设备使用 dou-bot 技能

最新技能文件为 [skills/dou-bot/SKILL.md](../skills/dou-bot/SKILL.md)，调用名是 **`$dou-bot`**。`$dd-bot` 已不再是当前技能名称。

旧设备用户目录中的技能安装不会随 Git 克隆迁移。可将仓库的整个 `skills/dou-bot/` 目录复制到新设备的技能目录：默认是 `~/.codex/skills/dou-bot/`；如果设置了 `CODEX_HOME`，则使用其下的 `skills/dou-bot/`。保留 `SKILL.md`、`agents/`、`assets/` 和 `references/`。

PowerShell，在仓库根目录执行：

```powershell
$skillParent = if ($env:CODEX_HOME) {
  Join-Path $env:CODEX_HOME 'skills'
} else {
  Join-Path $HOME '.codex/skills'
}
$skillTarget = Join-Path $skillParent 'dou-bot'
if (Test-Path -LiteralPath $skillTarget) { throw '目标技能已存在，请先比较内容再更新。' }
New-Item -ItemType Directory -Force -Path $skillParent | Out-Null
Copy-Item -LiteralPath './skills/dou-bot' -Destination $skillTarget -Recurse
```

Bash，在仓库根目录执行；同样只在目标不存在时复制：

```sh
skill_parent="${CODEX_HOME:-$HOME/.codex}/skills"
mkdir -p "$skill_parent"
test ! -e "$skill_parent/dou-bot" && cp -R ./skills/dou-bot "$skill_parent/dou-bot"
```

如果新设备暂未安装技能，可让开发助手直接读取仓库中的技能文件与所需参考。技能不增加 SDK 运行时依赖。技能重命名时已同步 README、贡献指南、默认调用提示和 `scripts/test-package.mjs` 中的资源路径；两项技能示例测试已通过。

## 6. 已有验证证据和边界

以下数字属于交接基线，不代表未来修改后的版本自动通过：

| 检查             | 已有结果                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| SDK 自动测试     | 184 项通过；另有实际 tarball 消费者及 2 项技能示例测试                                        |
| 独立业务示例     | 25 项离线测试通过                                                                             |
| 文档示例         | 14 项离线测试通过                                                                             |
| 文档浏览器       | 桌面/手机共 12 项通过，包含导航、搜索、主题切换、代码复制和深层页面刷新                       |
| 公开 API         | 当前源码 123 个导出、95 组双向类型检查；发布版 0.6.0 的文档索引为 122 个导出                  |
| 最近 CI          | 三个工程各自的 Windows/Linux 检查和 Pages 部署均成功，见交接首页链接                          |
| 当前源码持续运行 | 180,084ms，非预期错误为 0，结束时受管资源归零；见 [原始报告](soak-validation-1.0-review.json) |
| CI 持续运行      | Windows/Linux 各执行 30 秒模拟组合回归                                                        |
| QQ WS 实机       | 群聊/私聊收发、Markdown、图片、普通按钮、执行控制等已有记录；prompt 曾由用户反馈测试正常      |
| 仍缺的实机证据   | 公网 Webhook、群角色投递与管理者按钮分角色验收；不能用普通按钮成功替代管理者按钮验证          |

三分钟模拟长跑不等于已完成 24～72 小时测试，更不等于真实 QQ 多日业务观察。prompt 的人工确认没有逐项覆盖所有命令和场景，详细边界见 [validation-report.md](validation-report.md)。

浏览器测试曾遇到首次加载时过早点击静态搜索按钮的时序问题。现有 `website/browser-tests/docs.spec.ts` 已等待 Vue 客户端挂载后交互，线上复验通过；维护测试时保留这项初始化等待。

### 2026-10-01 新设备本地复验

环境为 macOS ARM64；使用隔离的 Node 24.0.0 / 24.21.0 和 npm 11.19.0 工具链，TypeScript 均为 5.9.3。验证时的工作树基于上面的 `66a4ad6`，包含当时尚未提交的本轮维护变更。

- Node 24.0.0 的 SDK 完整检查与覆盖率运行通过：184 项测试、123 个导出、95 组双向类型检查、实际 tarball 消费者和 2 项技能示例。
- Node 24.21.0 的 `check:all` 通过：SDK 184 项、技能示例 2 项、业务示例 25 项、文档示例 14 项；网站仍核对发布版 0.6.0 的 122 个导出，产物 35 个 HTML 页面和 1429 个本地链接/资源通过。
- 文档锁文件通过 `npm ci --ignore-scripts` 干净安装；VitePress 1.6.4 + Vite 6.4.3 + esbuild 0.25.12 的 `npm audit` 为 0 项告警。
- 生产预览桌面/手机共 12 项浏览器测试通过；开发服务器的桌面/手机渲染、导航、搜索、深层刷新、控制台及横向溢出检查也通过。Chromium 使用获准的沙箱外进程运行，检查结束后本地服务已退出。
- Node 24.0.0 的 30 秒模拟兼容性回归实际运行 30,042ms，非预期错误为 0，关闭后全部受管资源归零；本机原始报告位于忽略的 `work/soak-latest.json`。这是短时最低版本检查，不是 24～72 小时稳定性验收。

上述环境与依赖收尾阶段没有启动真实 QQ 服务。业务示例的本地 `.env` 已由所有者配置并确认被 Git 忽略；凭证内容不随仓库迁移。

### 2026-10-01 MIT 与 WS / 分角色实测

所有者已明确 SDK、业务示例、文档和配套技能统一采用 MIT。业务示例已补齐 LICENSE、NOTICE、package.json 与锁文件的许可信息；适用的上游声明继续保留。

业务示例仍使用 npm 的 dou-bot 0.6.0，本机已验证 QQ 凭证、网关获取与 WS READY 握手。该轮使用业务示例模块以及临时的角色字段/按钮观察器，日志只保留匿名参与者编号、角色字段、事件类别与结果，不保存凭证或实际 OpenID。临时文件位于被 Git 忽略的 `apps/example/work/`。

2026-10-05 提交前复核日志：探针已于 2026-10-01 01:51:51（Asia/Shanghai）结束 15 分钟测试窗口并关闭，累计收到 21 次心跳确认；记录到的测试消息与按钮交互均为 0。此次确认了连接与心跳，不补记为消息收发或分角色验收通过。

该轮结束时，群主、管理员、普通成员的角色命令和按钮交互仍待用户操作与客户端确认，不能由握手成功补记为已通过。2026-10-06 的独立补验结果见下节。

### 2026-10-06 新设备 WS 收发实测

重新启动发布版 SDK 0.6.0 的业务示例后，私聊与群聊的 `/hello`、`/example-button` 均收到并回复成功，两处普通按钮均收到回调、完成 ACK 并成功发送点击反馈。用户分别确认文字回复、Markdown 卡片显示和点击结果。共记录 4 条测试命令、2 次按钮交互、6 次成功发送和 5 次心跳确认，无错误；00:12:34（Asia/Shanghai）已主动关闭测试连接。

可随仓库迁移的脱敏结果见 [WS 实测记录](ws-validation-2026-10-06.json)。这次完成了新设备的基础 WS 收发验收；10 月 1 日未收到测试交互的历史记录继续保留。

### 2026-10-06 分角色验收进度

三个角色均已完成：用户分别确认实际身份，QQ 群消息投递 `author.member_role=owner`、`admin`、`member`，SDK 归一化一致。群主的两条角色命令均放行；管理员的群主命令被拒绝、管理者命令放行；普通成员的两条命令均被拒绝。

普通回调按钮对三种角色均成功。管理者回调按钮对群主、管理员完成回调、处理器、ACK 和反馈；普通成员点击后由客户端提示无权限或拒绝操作，后台没有对应回调或处理器执行。用户分别确认客户端结果。该轮记录 12 条命令、5 次允许的按钮交互、17 次成功发送、18 次心跳确认和 0 错误，00:29:13（Asia/Shanghai）验收完成后已关闭。证据见 [角色验收记录](group-role-validation-2026-10-06.json)；范围限于本次机器人、测试群与 callback 按钮。

## 7. 继续开发时需要保留的语义

完整说明见 [1.0 API 审查](api-review-1.0.md)。其中一些容易在重构中误改的行为包括：

- Provider 默认单例；模块的 imports/exports 决定依赖可见性，Controller 不作为共享 Provider。
- 参数消费顺序是 Option → Arg → Slot → Rest。Slot 匹配同步且无副作用，Rest 不掩盖歧义、重复或非法输入。
- 未发布 Attachments / Images 在文字绑定后选择顶层附件并校验数量，不切换旧/严格模式。selectAttachments 只同步筛选传入数组；分条附件在 prompt 返回后由业务校验，失败不自动重试或退还命令冷却。引用附件和 ASR 文本不会自动成为命令输入。
- 未发布 OnAttachment 只匹配顶层归一化附件，pending prompt 和已识别命令优先。各处理器独立授权、回复和追问，共享整条消息的去重、回复序号与操作预算；结束后旧 Context 失效，未等待的追问必须清理。
- 未发布身份参数在文字与附件绑定后、冷却前同步注入，不占输入位置。快照在归一化时冻结；按钮没有可靠角色，不从历史消息、权限或引用推断，缺失信息为 undefined。
- Guard 按模块 → 控制器类 → 方法执行。模块 Guard 只覆盖直接注册的控制器，不传播到导入模块，不保护原始 `On` 观察器，也不自动过滤帮助列表。
- Guard 拒绝和参数错误不占用冷却；命令别名共享冷却；业务执行失败不退还已占用的冷却。
- 业务必须 `await ctx.prompt()`。回答属于父流程，不重新走命令匹配、Guard 和冷却；后续回复使用新消息引用。
- `enqueue()` 的 accepted 只代表接纳；`done` 或 `dispatch()` 完成也不等于业务成功，仍需观察错误记录。
- 关闭会取消 prompt 等受管操作；用户异步业务要配合取消信号。同一个应用实例关闭后不能再次启动。
- 进程内队列和去重不提供跨重启的恰好一次处理保证。

本项目不需要为换设备重新实现框架，也不需要重新引入 Koishi、热更新或额外平台适配。

## 8. 下一步建议与验收条件

2026-10-01 已完成本地收尾：

- 现行 SDK 指南的旧仓库链接和权限措辞已更新，贡献入口已对齐单仓库；保留明确标注日期的历史记录。
- Node 支持范围已对齐三个工程的 engines、锁文件、文档和 CI 配置；SDK 的最低版本与开发版本均已本地验证。
- 文档工具依赖已完成版本评估、限定范围的 override、审计清零以及构建/API/浏览器验收，详见 [维护说明](repository.md#文档工具依赖维护)。
- 维护提交 `ada385b` 的 9 项远端 CI 已全部通过，包括四组 SDK 系统/Node 组合及文档部署。
- 所有者已统一采用 MIT，业务示例许可文件和包元数据已补齐。

2026-10-06 补充完成新设备基础 WS 收发，以及本次测试群的三种角色命令和管理者回调按钮验收；详细范围与记录见上文。

仍需完成以下事项；本地通过不替代新提交的远端 CI 或平台实测：

| 工作               | 当前缺口                             | 完成条件                                                                     |
| ------------------ | ------------------------------------ | ---------------------------------------------------------------------------- |
| 长时间稳定性       | 当前版本仅有三分钟模拟记录和短时 CI  | 安排 24～72 小时模拟负载、真实业务多日观察，保存对应提交、报告和异常分析     |
| Webhook 公网验收   | 尚无 HTTPS 测试入口                  | QQ 地址验证、真实签名回调、消息与按钮投递、重复投递及平台重试通过            |
| 1.0 候选与正式发行 | npm 仍是 0.6.0，源码新增类型尚未发布 | 明确候选版本，完成验收、变更与迁移说明，再执行对应发布；同步示例、文档和技能 |

文档工具 override 属于本仓库维护的兼容组合，后续 VitePress 稳定版正式采用已修复依赖时再移除并重新验证。当前审计清零不代表未来不会出现新公告；CI 会继续执行审计。

持续运行工具已支持 30 秒～72 小时。短时确认可运行：

```sh
npm run soak -- 180000
```

计划长跑时，将时长改为 `86400000`（24 小时）或 `259200000`（72 小时），按计划选择一种；本次交接没有启动这些任务。工具使用模拟网络和真实计时器，不连接 QQ。报告在 `work/soak-随机ID.json` 和 `work/soak-latest.json`，被 Git 忽略，应另外保存需要交付的结果。

## 9. CI、部署与发布注意事项

唯一工作流为 [.github/workflows/ci.yml](../.github/workflows/ci.yml)。提交和 PR 执行三个工程的检查；只有 `main` 的非 PR 工作流在全部检查成功后部署 Pages。站点产物路径为 `website/docs/.vitepress/dist`，Pages Source 是 GitHub Actions，环境为 `github-pages`，站点 base 为 `/dou-bot/`。

CI 不自动发布 npm。实际 npm 发布需要新设备自己的认证和本次发行的明确版本安排，不能复用历史浏览器验证码或把旧的 0.6.0 发布步骤当成新版本已发布。

SDK 只从主仓库根目录发布，发行白名单不包含 `apps/`、`website/` 或技能目录。README 也随包发布，所以新增相对链接必须指向包内存在的文件；仅供维护使用的文档入口可使用主仓库的完整 GitHub 链接。

升级 SDK 文档版本时，需要一起更新两个子工程的精确 SDK 依赖和锁文件、`apps/example/vendor/sdk.json`、网站版本标识/API 索引、技能描述和示例验证。发行流程与旧包的完整性记录见 [npm-release.md](npm-release.md) 和 [npm-release-0.6.0.json](npm-release-0.6.0.json)。

## 10. 旧设备上不需要搬走的内容

旧的两个独立项目本地副本已经删除，GitHub 归档与主仓库中的历史仍在。此前已清理构建产物、旧日志、截图和临时工作副本；源码、三个工程的依赖及本地 `.env` 当时均保留。

随后技能改名验证重新生成了 `work/package-check/`、`work/stack-selection/` 和系统临时目录中的技能校验依赖。递归删除命令被自动审批以 `blocked by policy` 拒绝，所以这些本地临时文件仍可能存在。它们不在 Git 中，也不是新设备继续工作的前提，无需迁移或在新设备重建这些历史临时目录。

新设备通过仓库和锁文件恢复环境即可；真实 `.env` 单独配置。不要把旧设备的 `node_modules`、编译产物、账号登录缓存或历史探针日志当作项目源文件复制进仓库。

## 11. 可交给下一段开发对话的接续说明

可以直接粘贴以下文字，并补充你本轮想完成的具体事项：

> 请先阅读 `docs/handoff.md`、`docs/repository.md`、`docs/api-review-1.0.md` 和根目录 README，核对当前分支、提交、未提交改动及 CI。
>
> 这是 dou-bot 单仓库：根目录是 SDK，`apps/example` 是业务示例，`website` 是文档站。已发布版本为 0.6.0，源码包含尚未发布的 TestAdmission；示例和文档仍使用 npm 的 0.6.0。配套技能名称是 `$dou-bot`。
>
> 当前源码的未发布附件 API 为 Attachments / Images、AttachmentOptions、selectAttachments 及相关类型和语音扩展字段；Videos / Audios / Files 已移除。视频、音频和文件改为业务显式 prompt 后筛选。用根目录源码示例或当前 tarball 验证，勿让仍依赖 npm 0.6.0 的业务示例与网站提前导入这些 API。
>
> 当前源码还包含尚未发布的五种身份参数装饰器与 UserInfo / GroupInfo，当前公开契约为 1.11。它们支持命令、按钮与 OnAttachment，缺失信息注入 undefined；本轮只进行了离线和本地协议验收。
>
> 当前源码还包含未发布的 OnAttachment / OnAttachmentOptions，支持文件名、扩展名及分类筛选；多个附件处理器独立顺序执行，允许 await prompt。GuardContext.kind 增加 attachment 分支，自定义 Guard 的旧二分支判断需要迁移。
>
> 保持 QQ 官方群聊/私聊、WS/Webhook、轻量依赖和 TypeScript 5.9.3 的既定方向。先用离线检查确认新设备环境，再按本轮任务推进交接文档中的待办；真实 QQ 联调、长时间运行和 npm 发布按本轮明确的任务范围执行。SDK、业务示例、文档和技能均采用 MIT；公网 Webhook 和分角色实测的完成状态以当前验收记录为准。

这份交接记录提供项目背景，不替代新设备上的实际状态检查或本轮用户要求。
