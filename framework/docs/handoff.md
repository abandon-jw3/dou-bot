# dou-bot 新设备开发交接

更新：**2026-10-20（Asia/Shanghai）**。本次提交基线为 `main / 99230b5c110cc98ac300b1e820856120a2b0c430`，该基线 CI 已通过。本机双 WS 实测已通过，两个验收实例已关闭；探针及本轮记录由本次提交收录。新设备接续前核对实际 HEAD、工作区和对应 CI。

## 2026-10-20 接续状态

- main / 082e88a 已推送；十个 CI 任务全部 completed / success（含文档部署），工作流汇总已确认 completed / success。详细证据见 [生产准备记录](readiness-2026-10-20.md)。
- 所有者已明确：旧的本机 TEST_DATABASE_* 配置不能继续使用。后续真实数据库测试先取得新的专用配置；本轮数据库证据采用 CI 自建 PostgreSQL 17。
- 原连接参数完整复测出现 23 次建连重置；原生 TCP 对照复现本机监听队列限制。保持事件速率、限制为 64 条 HTTP 连接后，350 秒 / 149,750 次首次事件完整性通过，零连接错误。
- 上一轮新增压测诊断、关闭实验修正和回归测试，由 99230b5 收录；SDK 运行时与公开契约不变。该轮未连接真实 QQ，未发布 npm。

## 双 WS 实测完成

- 本轮压测与回归已提交推送为 99230b5，[对应 CI](https://github.com/abandon-jw3/dou-bot/actions/runs/39289989155) 已 completed / success。
- 本机双 WS 探针已实现，操作见 [验收指南](live-multi-bot.md)。配置仅取忽略的 framework/.env；模板保留占位符，不读取旧 TEST_DATABASE_*。
- 新专用 PostgreSQL 17.6 显式初始化成功；真实 A、B 私聊和同群收发、群地址持久化、WS 触发主动发送、停止 A 时 B 独立工作、恢复 A 后收发均通过用户确认。详见 [本轮实测](live-multi-bot-2026-10-20.md) / [JSON](live-multi-bot-2026-10-20.json)。
- 实测确认同一个群在两个机器人下的 OpenID 不同。停止、恢复 A 后共享服务保持原实例；结束时进程退出码 0、数据库框架连接数为 0。
- Node 24.0.0 / 24.21.0 SDK 检查各 341 项：339 通过、2 项专用数据库测试跳过；公开契约和当前 tarball 通过。探针、指南及实测记录由本次提交收录，SDK 版本与契约未改动；新提交 CI 需推送后核对。
- 下一步仍需按任务范围开展多机器人混合 WS/Webhook、故障恢复和多日观察；本轮两个机器人、一个群的样本不代表容量验收。

## 新版本开发方向（2026-10-18，尚未发布）

- 所有者确认：新版本作为新的开始，不提供旧 SDK 迁移路线，不以旧项目兼容性约束 API。
- 当前验收面向新契约与源码 tarball；历史发布包可用 test:history:0.6 / 0.7 / 0.8 单独复验，不是新版本准入条件。

- 2026-10-18：重构和文档调整已合回主工作树 main，由本提交统一收录；后续在仓库主目录继续开发。
- 重构基线仍为 07d2c3e；主工作树原有 Webhook 修复及 Benchmark 改动完整保留。
- 临时工作树的本地日志、探针和包消费者资料已备份到 `framework/work/worktree-integration/2026-10-18-325c13c7/refactor-work-evidence.zip`。该文件被 Git 忽略，跨设备按需单独携带。
- 新入口 AppFactory：共享业务服务，多账号 WS/Webhook；强制 PostgreSQL，显式迁移。
- 群地址始终为 appId + groupId；不合并真实群，不跨账号替换 OpenID。
- 新增 MessageSender、BotManager、GroupRoutes、Database，源码契约 2.0。
- 仅基础地址持久化；消息任务、冷却、执行去重仍在内存。
- example、website、技能继续使用 npm 0.8.0。没有启动真实 QQ，没有发布或部署。
- 两版 Node 完整检查、真实 PostgreSQL、当前/历史消费者、覆盖率、短时持续运行及虚拟容量验证已通过；实测成本和边界见 [重构验收](multi-bot-refactor-2026-10-18.md)。
- 接续优先阅读 [SDK 使用说明](../README.md) 与 [多机器人指南](multi-bot.md)。尚未验证真实双机器人 QQ；新 CI 需推送后执行。
- 2026-10-18 全框架质量复核：修复 10 个已复现问题，新增 14 项行为回归；两版 Node 各 335 项（333 通过、2 个离线跳过），真实 PostgreSQL 各 5/5。吞吐保持相近，30 秒模拟与两小时虚拟容量回归通过。详见 [质量审查](quality-review-2026-10-18.md) / [JSON](quality-review-2026-10-18.json)。本轮改动由本提交一并收录，尚未推送或发布。

下面 2026-10-14 的状态及历史实测保留作为基线。

## 1. 当前状态

| 项目         | 状态                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| 仓库         | [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot)，默认分支 main              |
| 已发布 SDK   | **dou-bot 0.8.0**；npm latest=0.8.0，next=0.6.0                                           |
| 发行来源     | v0.8.0 → c02e4ac；当前源码另含尚未发布的 Webhook 过载连接复用修复                         |
| 消费者       | example、website、仓库技能均已同步到 npm 0.8.0                                            |
| 公开契约     | 1.14；148 个导出、108 组类型契约检查                                                      |
| 最新功能提交 | f29fb89 同步示例、网站与技能；7f92a49 提交 Webhook 收发及故障恢复记录                     |
| 已核对 CI    | [07d2c3e 的工作流](https://github.com/abandon-jw3/dou-bot/actions/runs/38361390176)：成功 |
| 工作区基线   | 本轮开始前干净；当前有未提交的 Benchmark 工具、记录和连接复用修复                         |
| 真实服务     | 2026-10-13 检查时三个临时服务均已停止；本轮本机 Benchmark 未重新检查服务器                |

发行详情与完整性见 [0.8.0 说明](release-0.8.0.md) 和 [发布记录](npm-release-0.8.0.json)。本交接提交触发的新 CI，需要按新提交另行核对。

## 2. 必须保持的约定

- **行为结论以实测为准。** 文档、源码只用于提出假设；分开记录离线模拟、公网合成请求和真实 QQ 实测。未测项目标为未验证。
- 所有者明确要求：**不以 QQ 官方 SDK 实现或其 SDK 文档作为参考**。
- 方向保持 QQ 官方群聊/私聊、WS/Webhook、轻量依赖、ESM 与 TypeScript 5.9.3。
- SDK 生产依赖仍只有 reflect-metadata 0.2.2、ws 8.22.0。三个工程均为 MIT。
- 用户文档和 `$dou-bot` 技能面向框架使用者，按功能分点，言简意赅。
- 真实 QQ 联调、长时间运行、npm 发布及外部部署按本轮明确范围执行；已有授权可延续，先核对实例和现场状态。
- 历史 JSON、源码指纹及测量数据保留原文。新结论新增记录，不改写旧证据。

## 3. 三个工程与版本边界

| 目录       | 用途与入口                                                                         |
| ---------- | ---------------------------------------------------------------------------------- |
| framework/ | SDK、测试、源码示例、脚本、维护文档与技能；SDK 命令在此目录执行                    |
| example/   | 独立业务示例，精确依赖 npm 0.8.0；根目录有 example:check/build/start/dev           |
| website/   | VitePress 用户文档，精确依赖 npm 0.8.0；根目录有 docs:dev/build/check/test:browser |
| 根目录     | private 操作入口，仅 install:all、check:all 和两个消费者的转发命令                 |

- 三个工程分别安装依赖；没有 npm workspaces、源码依赖链接或根锁文件。
- 根目录不再是 SDK；没有旧 apps/example、根 src/docs/scripts 入口。
- framework/examples 使用 SDK 源码；example、网站示例与技能使用已发布包。
- SDK 发包只在 framework 执行。CI 不自动发布 npm；main 的 CI 全部成功后部署 Pages。

当前 API 接续：

- 附件使用 Attachments / Images、selectAttachments 和 OnAttachment；Videos / Audios / Files 从未发布，当前也不导出。
- User / UserId / Group / GroupId / Role 读取当前事件的身份快照；缺失信息不自动查询。
- Slot.normalize 只做同步字符串转换；异步上下文准备使用 prepare、state.set/provide、ContextValue/state.get。DefaultFrom、数据库查询及业务缺省策略未实现。

完整规则见 [仓库指南](repository.md)，历史布局见 [迁移记录](directory-migration-2026-10-11.md)。

## 4. 新设备先恢复环境

- 开发版本：Node.js **24.21.0**、npm **11.19.0**；TypeScript **5.9.3** 由锁文件安装。
- SDK 支持 `>=24.0.0 <25`；根目录、example、website 要求 `>=24.21.0 <25`。
- 安装 Node 后，需要时执行 `npm install --global npm@11.19.0`。

首次克隆后，在仓库根目录执行：

```sh
git clone https://github.com/abandon-jw3/dou-bot.git
cd dou-bot
git status --short --branch
git log -1 --oneline
node --version
npm --version
npm run install:all
npm run check:all
```

已有检出先确认工作区，再用 `git pull --ff-only` 更新。安装和包消费者检查会访问 npm，但上述检查不连接真实 QQ，不需要机器人凭证。

浏览器验证：

```sh
npm --prefix website exec -- playwright install chromium
npm run docs:test:browser
```

Linux 缺少浏览器系统库时使用 `playwright install --with-deps chromium`。已有 check:all 会构建站点。

SDK 专项检查按改动需要执行：

```sh
cd framework
npm run coverage
npm run example:offline
```

- 常规 check 只使用当前契约验证源码 tarball。历史发布包可按需运行 test:history:0.6 / 0.7 / 0.8，结果不限制新版本设计。
- 在最低 Node 24.0.0 与开发版 24.21.0 分别验证 SDK；不要在最低版本下运行要求更高的根命令或网站工具。
- 若进程测试受沙箱监听或子进程权限限制，记录原错误并在获准环境复核，再判断是否代码问题。
- 本机 Node 二进制、node_modules、构建产物、npm/浏览器缓存和本地代理地址不属于跨设备配置。

## 5. 凭证、技能与本地资料

- 本机机器人配置在被 Git 忽略的 `example/.env`，当前没有 framework/.env；克隆仓库不会获得凭证。
- 新设备通过安全渠道配置自己的 `.env`、SSH 和 Git 认证。公开克隆及 npm 包安装不需要旧设备登录态。
- example 当前启动入口使用 WS；运行 example:start/dev 会连接真实 QQ。切换设备或接入方式前先确认同一机器人实例状态。
- 源码普通探针通常读取 framework/.env，附件探针明确读取 example/.env；按各入口说明使用。
- 技能入口为 [skills/dou-bot/SKILL.md](../skills/dou-bot/SKILL.md)，名称 `$dou-bot`。可让助手直接读取；需要安装时，将整个目录复制到新设备的技能目录，保留 references/assets/agents。

**Git 中已有：** SDK 与工程源码、锁文件、用户指南、技能，以及两轮实测的脱敏 Markdown / JSON。

**Git 不包含：** 以下临时探针源码、辅助脚本和本机完整日志。复用这些资料时单独迁移所需文件，排除凭证、node_modules 与缓存：

- `framework/work/production-validation/2026-10-13-cf13e5/`
- `framework/work/recovery-validation/2026-10-13-c54679/`

新设备继续 SDK 开发不依赖这两个目录。服务器也保留部署副本：基础探针有编译产物，恢复探针另有 src；真实事件正文只在内存中短暂保留，测试结束后已清空。

## 6. 已实测的功能与边界

- 2026-10-14 新增 350 秒本机混合 HTTP 压测：149,750 条首次事件、覆盖 2,000 群标识；200/s 阶段无排队、500/s 持续积压，故障后约 18.8 秒排空。SDK 一致性与资源回收通过；2,500/s 突发档仍有 18 次连接重置，因此整轮未全通过，具体原因待定位。完整统计见 [混合报告](benchmark-mixed-2026-10-14.md) / [JSON](benchmark-mixed-2026-10-14.json)。原始及失败报告在忽略的 framework/work/mixed-benchmark，需要时单独迁移。

- 本轮混合 HTTP 压测发现：已读完且验签通过的请求，过载 503 会强制关闭连接；高峰叠加模拟重试时出现本机端口耗尽。新增连接实测从 100 次过载 / 100 条连接改为复用 1 条连接；非法签名、超大正文和未完成请求仍关闭。源码修复尚未发布，公开契约保持 1.14；两版 Node 完整检查各 298 项测试通过。原始报告及源码归档在 framework/work/mixed-benchmark/mixed-benchmark-evidence-2026-10-14.zip；见 [混合 Benchmark](benchmark-mixed-2026-10-14.md)。

- 2026-10-14 完成本机 M4 / Node 24.21.0 的 8 场景 Benchmark：两次各五轮吞吐、独立延迟采样及逐场景内存测量。结果是执行器入口的单进程串行模拟，不包含 WS/Webhook 传输、QQ 或数据库；详见 [本机 Benchmark](benchmark-2026-10-14.md) / [JSON](benchmark-2026-10-14.json)。逐事件数据及测量程序位于忽略的 `framework/work/benchmark-runs/2026-10-14-2a504b/`。
- 0.8.0 发行验收：两版 Node 各 293 项 SDK 测试，历史与当前包消费者通过；对应来源见 [发行记录](release-0.8.0.md)。
- 已有 65 分钟真实计时的**模拟**负载，以及两小时**虚拟时间**容量回归；均不能替代多日真实 QQ 观察。目标 2,000 群、每群每天 50 次调用目前是估算，见 [容量审查](capacity-review-2026-10-11.md)。
- 0.6.0 的 WS 基础收发及本次测试群的三角色/管理者按钮验收已有证据；没有把旧版本结果改记成 0.8.0 全角色实测。
- 0.8.0 公网 Webhook：私聊、群聊的文字、Slot 归一化、上下文、按钮、图片、DOCX 路由和多轮对话通过；私聊取消及群聊超时通过。
- HTTP 503 和延迟响应后，实际观察到 QQ 自动重投；进程内受控重放被去重，进程异常退出后自动拉起，新进程收发通过。

**1.0 需要明确的两个边界：**

1. 已返回 HTTP 200、但处理器尚未完成的任务，崩溃后没有在新进程中自动恢复。
2. 相同事件跨进程重启后会再次执行；进程内去重不能提供持久化幂等。

持久化接纳、数据库或跨进程去重均未设计或实现；是否扩展框架能力需要另行确定范围。去重重放来自受控测试，不能表述为平台在重启后自动重投。

证据入口：

- [基础 Webhook 实测](webhook-validation-2026-10-13.md) / [JSON](webhook-validation-2026-10-13.json)
- [故障与恢复实测](webhook-recovery-validation-2026-10-13.md) / [JSON](webhook-recovery-validation-2026-10-13.json)
- [1.0 API 审查与待办](api-review-1.0.md)

视频、语音、其他附件、DOCX 内容处理、整机故障及入口进程崩溃没有在这两轮中验证。重试间隔只描述本轮样本，不是平台固定保证。

## 7. 服务器交接

以下为 2026-10-13 的现场检查结果：三个验收服务均 inactive，31080/31081 无监听；Nginx 配置检查通过，证书验证通过，certbot.timer active。本轮本机 Benchmark 未重新检查服务器，继续远程工作时先核对现场。

| 项目         | 位置或状态                                                                              |
| ------------ | --------------------------------------------------------------------------------------- |
| SSH          | `root@43.143.160.168`；新设备需自行具备 SSH 登录权限                                    |
| 系统         | Debian 12 / x86_64                                                                      |
| 已验证回调   | `https://qq.fineiii.xyz/dou-bot/qq`，公网 443                                           |
| 专用 Node    | `/opt/node-v24.21.0-linux-x64/bin/node`；服务器原默认 Node 22 未替换                    |
| Nginx 片段   | `/etc/nginx/dou-bot-validation.conf`，回调转发至 127.0.0.1:31080                        |
| 基础部署     | `/opt/dou-bot-validation`                                                               |
| 恢复部署     | `/opt/dou-bot-recovery-validation`，试验时另用 127.0.0.1:31081                          |
| 机器人凭证   | `/etc/dou-bot-validation/qq.env`，root:600                                              |
| 探针控制凭证 | `/etc/dou-bot-recovery-validation/control.env`，root:600                                |
| TLS 证书     | `/etc/letsencrypt/live/dou-bot-validation/`；本次证书到期为北京时间 2027-01-11 00:38:19 |
| 续期         | certbot timer；部署钩子 `/etc/letsencrypt/renewal-hooks/deploy/dou-bot-nginx` 已验证    |

三个临时服务名：

- `dou-bot-validation.service`
- `dou-bot-recovery-gateway.service`
- `dou-bot-recovery-worker.service`

它们不是常驻业务实例，没有设置开机自启。原探针带 30 分钟窗口，恢复探针还绑定了绝对 expiresAt；重用前重新准备配置和测试范围，不能直接把旧探针当成长期服务。

新设备可先只读核对：

```sh
ssh root@43.143.160.168 'systemctl show dou-bot-validation.service dou-bot-recovery-gateway.service dou-bot-recovery-worker.service --property=Id --property=ActiveState'
ssh root@43.143.160.168 'nginx -t'
```

公网仅验证 443 入口；31080/31081 是内部端口。健康检查和控制接口未公开。QQ 后台回调地址保留，临时服务停止时不会处理业务消息。

服务器有其他应用，继续操作前核对所选目录、服务与 Nginx 片段。回调使用 qq.fineiii.xyz；此前讨论过的 koishi.fineiii.xyz 不是本次验收入口。

## 8. 下一轮任务

1. **先恢复新设备并完成离线检查。** 核对 HEAD、工作区、Node/npm 与该提交的 CI。
2. **安排稳定性验证。** 尚未启动 24～72 小时模拟长跑或真实 QQ 多日业务观察；明确时长、负载、消息范围、资源预算和停止方式后执行，保留报告。
3. **补齐 Linux 用户部署指南。** 将已实测的 Nginx/systemd 配置整理为简洁教程，验证运行、监测、升级与回滚步骤。
4. **准备 1.0 候选。** 明确接纳与幂等边界、兼容/弃用约定，完成 RC 试用及实际候选的完整回归后再发布。

长跑脚本位于 framework，`npm run soak -- 86400000` 表示 24 小时**模拟网络、真实计时**运行，不会变成真实 QQ 生产观察。本交接没有启动长跑。

## 9. 给新设备助手的接续指令

> 请先阅读 framework/docs/handoff.md、framework/docs/repository.md、framework/docs/api-review-1.0.md 和根 README，核对 main 的最新提交、工作区和 CI。项目分为 framework、example、website；SDK 0.8.0 已发布，示例、网站和技能均使用 npm 0.8.0。保持 Node 24.x、TypeScript 5.9.3、轻量依赖与 QQ 官方群聊/私聊方向。
>
> 一切行为结论以实际测试为准，区分离线、公网合成与真实 QQ 证据；不以 QQ 官方 SDK 作为参考。公网 Webhook 收发、503/延迟后的自动重投、受控去重和 SDK 崩溃恢复已实测。跨重启会再次执行相同事件，已确认但未完成的任务未自动恢复；持久化接纳与幂等尚未实现。
>
> 三个服务器临时探针均已停止，HTTPS 保留；本机临时探针目录和 .env 不在 Git。先完成新设备离线恢复，再按本轮明确任务推进稳定性、Linux 用户指南或 1.0 候选。真实 QQ、长跑、部署及 npm 发布按已确认范围执行；用户文档和技能保持简洁、面向使用者。

旧交接原文见 [历史交接存档](handoff-history-2026-10-13.md)。其中的旧版本、未发布措辞及旧待办只反映当时状态。
