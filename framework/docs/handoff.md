# dou-bot 新设备开发交接

更新：**2026-10-13（Asia/Shanghai）**。本次核对基线为 `main` / `7f92a49657ae61b4e1405fd68ff4829f8ac79a23`；交接文档提交位于该基线之后。新设备拉取后，以实际 HEAD、工作区和对应 CI 为准。

## 1. 当前状态

| 项目         | 状态                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| 仓库         | [abandon-jw3/dou-bot](https://github.com/abandon-jw3/dou-bot)，默认分支 main                                     |
| 已发布 SDK   | **dou-bot 0.8.0**；npm latest=0.8.0，next=0.6.0                                                                  |
| 发行来源     | v0.8.0 → c02e4ac；当前 framework/src 与该标签无差异                                                              |
| 消费者       | example、website、仓库技能均已同步到 npm 0.8.0                                                                   |
| 公开契约     | 1.14；148 个导出、108 组类型契约检查                                                                             |
| 最新功能提交 | f29fb89 同步示例、网站与技能；7f92a49 提交 Webhook 收发及故障恢复记录                                            |
| 已核对 CI    | [7f92a49 的工作流](https://github.com/abandon-jw3/dou-bot/actions/runs/38291151094)：9 项全部成功，含 Pages 部署 |
| 工作区基线   | 开始本次交接前干净；本轮仅整理文档                                                                               |
| 真实服务     | 三个临时验收服务均已停止，内部端口关闭；HTTPS 和续期配置保留                                                     |

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
npm run test:compat
npm run test:compat:0.7
npm run test:published
npm run example:offline
```

- 常规 check 已包含当前 tarball 消费者；另外三项消费者分别验证历史 0.6.0、0.7.0 和已发布 0.8.0。
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

本次重新检查确认：三个验收服务均 inactive，31080/31081 无监听；Nginx 配置检查通过，证书验证通过，certbot.timer active。

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
