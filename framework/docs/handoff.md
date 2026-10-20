# dou-bot 新设备开发交接

更新：**2026-10-21（Asia/Shanghai）**。本次提交收录 c654be3 之后的 WS 工具、指标索引优化、PostgreSQL 故障修复、测试与报告。所有者已授权提交、推送，并在本次 CI 全部成功后继续真实 SQL 接入 WS/Webhook 的容量验证。上一个已核对的推送基线为 f8dde93，[对应 CI](https://github.com/abandon-jw3/dou-bot/actions/runs/39294649601) 已 completed / success；本次推送必须另查准确提交的 CI，成功前不启动容量测试。

[正式版六项待办](api-review-1.0.md#仍未完成的-10-门槛)已同步。第一轮专用 PostgreSQL 与慢接口专项已完成；候选 CI、真实 SQL 固定速率容量、混合接入实测及长跑仍待开展。

## PostgreSQL 与慢接口专项完成

- 真实 PostgreSQL 复现并修复三处问题：事务等待业务代码时断连、迁移断连产生未捕获异常，以及关闭超期中断 SQL 导致连接重复归还。没有新增 API、依赖或自动重试。
- 服务器使用独立 PostgreSQL 17.6 临时容器，0.5 核 / 256 MiB、仅本机端口和临时数据目录；未读取 framework/.env 或使用既有数据库。容器已清理，证据保留。
- Linux 两版 Node 的数据库专项各 16/16。两个账号、2,000 个合成群位置、冷/热两轮共 8,000 条命令完成，80 次重复投递去重；连接池峰值 4、等待峰值 12，关闭后归零。事件直接进入执行器、QQ 请求为夹具，闭环结果不是固定速率容量结论。
- 两版 Node 的 SDK 完整检查各 407 项：394 通过、13 专用 DB 跳过；178/136 契约与当前 tarball 通过。当前 SDK 指纹 `efbd2880a235c874e078728023b9b3bb7f0286d94af2c49811e1c0e7fb0c10e7`。
- 失败版本与最终结果见 [数据库专项](postgres-readiness-2026-10-21.md) / [JSON](postgres-readiness-2026-10-21.json)；本地证据位于 `framework/work/postgres-readiness-2026-10-21/`，服务器同名验收目录保留。不要将旧容量报告归到本轮新指纹。
- 本轮未提交、推送、发布，未连接真实 QQ。下一步先固定候选和 CI，再补 PostgreSQL 与 WS/Webhook 的固定速率容量、整库不可用和进程重启验证。

## 指标索引与出站对照完成

- 最终只保留有界的指标系列分层索引，减少每次记录时的 JSON 键分配；标签、顺序、采样、取消、容量与公开 API 不变。HTTP 解码小优化在协议层未显示稳定收益，已恢复原实现；最近标签缓存的变化场景退化，亦未保留。
- WS 500/s、128/32、120 秒指标对照：基线 SDK CPU 0.9898 / 1.0051 核，最终 0.9716 / 0.9800 核，样本均值约低 2.17%；每轮 60,000 条全部接纳/完成。小样本不能推断固定收益或更高吞吐上限。
- 基线 750/s、180 秒，仅将出站 32 改为 64：分别完成 115,921 / 114,197 条，计划均 135,000，尾队列仍积压。没有上调框架默认并发。报告见 [成本与优化验收](http-diagnostics-2026-10-20.md) / [JSON](http-diagnostics-2026-10-20.json)。
- 一轮组合候选与版本准备编译重叠，已明确排除性能比较并补测；原始结果保留。两份 CPU profile 单列，只用于定位，不算容量样本。
- 最终 SDK 指纹 `66e1dbe3503e83d3bb01dd7db1e2ce54880067aa43f27021ad556f796e64b4a9`；工具保持上一轮最终版本。两版 Node 各 396 项：394 通过、2 专用 DB 跳过；178/136 契约、当前 tarball、Linux 52 项专项通过，行覆盖率 95.60%，30 秒本机模拟回归资源归零。
- 证据在忽略目录 `framework/work/http-diagnostics-2026-10-20`；服务器 `/opt/dou-bot-capacity/http-diagnostics-2026-10-20-c654be3` 保留 baseline / candidate / index-only。58 份远端文件逐一 SHA 校验；勿重复启动已结束的 matrix / isolate / after-isolate 脚本。
- 测试、观察器、inspector 和 SSH 转发均已结束；Nginx PID 989 未变，PostgreSQL 就绪、未重启、无 OOM。没有真实 QQ、SQL 或渲染负载；本轮未提交、推送、发布。下一步应纳入专用 SQL 和实际业务接口延迟，明确持续负载与过载交付要求。

## WS 容量验收完成

- 同一个共享应用，真实 SDK WS 接收链路，支持单账号、双账号均匀/倾斜负载及 A 重连/停止/恢复时 B 持续工作。用法见 [分布式基准](benchmark-distributed.md)。
- 发压端和模拟网关在本机，服务器 SDK、HTTP 夹具、监督进程共享 1.5 核 / 1 GiB；没有真实 QQ、SQL、Nginx/TLS 或渲染负载。SDK 运行时保持上一轮 B，默认并发不改。
- 单 WS 500/s 两轮各 150,000 条全部接纳/完成，成功 P95 584 / 577 ms；750/s 两轮分别完成 155,050 / 148,548 条，计划均为 180,000，尾部仍积压。双 WS 总计 500/s 的 50/50、80/20 各一轮通过。中间档位与长期容量尚未定位。
- 500/s 指标轮通过且无诊断丢弃，SDK 平均 CPU 约 0.996 核，对照关闭时约 0.87 核。墙钟阶段耗时不是 CPU，不能把上下文夹具延迟当成框架热点。下一步优先分析共享 HTTP/出站和分配成本，再验证专用数据库及实际业务负载。
- 第一版 WS 400/s 因晚到的预设 onError 被工具误判而失败，原样保留；v2 在内部上报入口同步计数，原异步回调照常执行。完整范围、失败与缓存预算边界见 [WS 报告](ws-capacity-2026-10-20.md) / [JSON](ws-capacity-2026-10-20.json)。
- 两版 Node 各 392 项：390 通过、2 专用 DB 跳过；178/136 公开契约、当前 tarball、Linux 17 项专项通过，行覆盖率 95.60%。两版工具的服务器故障样本中 B 均有 2,196 条首次全部完成；A 停止期间的损失保留，不计为容量通过。
- 本地证据在忽略目录 `framework/work/ws-capacity-2026-10-20`；服务器 `/opt/dou-bot-capacity/ws-2026-10-20-c654be3` 保留 checkout / v2 与原始数据。49 份远端文件逐一核验 SHA；不要重复启动已结束的矩阵或自动收尾脚本。
- 本轮服务、观察器和 SSH 转发均已结束；Nginx PID 989 未变，PostgreSQL 就绪、未重启、无 OOM。automation 65 保持暂停。本轮新增 WS 改动未提交、推送或发布。

## 高负载阶段定位完成

- 工具新增约 5 秒累计快照、区间直方图差分和跨阶段标记；另修复大型报告传输及发压端空闲连接复用问题。原始失败均保留，用法见 [分布式基准](benchmark-distributed.md)。
- 在相同 1.5 核 / 1 GiB 配额下，基线 400/s 的 off/metrics 各两轮通过。500/s 反复积压；两轮指标测试还触及既定发压上限，不能当作有效恒定负载容量样本。
- 依据 CPU 样本减少正常收尾时无用的 prompt 错误对象，并复用去重淘汰游标；保持 TTL、活动项保护、回复序号、取消语义和公开 API。
- 最终代码 B 在 128/32、500/s × 5 分钟下通过一轮、失败一轮；128/64 两轮都失败。不能用最好的一轮宣布稳定 500/s，也没有继续提高默认并发。完整范围和逐轮结果见 [定位报告](bottleneck-review-2026-10-20.md) / [JSON](bottleneck-review-2026-10-20.json)。
- 两版 Node 各 389 项（387 通过、2 项专用 DB 跳过）；178 个导出、136 组类型契约、当前 tarball、Linux 专项通过；行覆盖率 95.60%。30 秒本机回归与两小时虚拟容量通过，不能代替服务器多日业务运行。
- 本地证据在忽略目录 `framework/work/bottleneck-2026-10-20`；服务器在 `/opt/dou-bot-capacity/bottleneck-2026-10-20-df32a0f`。基线 v1/v2/v3、候选 A/B、失败原文与 CPU 样本分开保存；90 份远端文件已逐一核对 SHA。所有本轮单元与转发已清理，Nginx PID 989 未变，PostgreSQL 就绪、未重启；不要重复启动已结束的矩阵。
- 接续优先独立测 WS，再拆分 HTTP 请求生命周期与对象分配成本。真实 SQL、业务接口、渲染及多日运行仍待验证。本轮未使用旧 TEST_DATABASE_*，未启动真实 QQ，未提交、推送、发布或部署业务服务。

## 阶段性能观测完成

- 新增应用级 `diagnostics` 配置和 `app.diagnostics.snapshot()` / `takeSpans()`；指标、在途观测、采样缓冲均有界，默认关闭。用户用法见 [观测指南](diagnostics.md)。
- 覆盖入口解析/验签、接纳/排队/执行、中间件/Guard/绑定/懒加载、处理器、回复串行等待、出站与确认通道、Token/HTTP、prompt、路由存储整体及缓存清理。墙钟耗时不等于 CPU，嵌套/并行时间不可相加。
- 可选 `onSpans` 异步批量导出，错误不会进入业务 onError；超时后未合作的批次继续占预算，避免无限累积。记录仅有固定阶段、配置账号和注册处理器等标签，不保存正文、用户/群/QQ 消息 ID、URL、SQL 或异常文本。
- 已修复新观测读取器关闭后保留应用的引用问题；保留 reader 时应用可回收，GC 回归在本机两版 Node 和 Linux 24.21 均通过。
- 最终两版 Node 各 384 项（382 通过、2 项专用 DB 跳过）；178 个导出、136 组类型契约、当前 tarball、源码演示及仓库检查通过。整体行覆盖率 95.59%，观测实现 98.87%。
- 同机固定 300/s、128/32、每轮 60 秒，off/metrics/1% sampled 各两轮全部通过，未丢发或丢诊断数据。SDK 平均 CPU 为 0.770 / 0.840 / 0.823 核；这是观测成本测试，不能据此推断最大吞吐。两次重复不足以把细小差异当作稳定收益。
- 正式开销矩阵使用引用修正前的冻结版本；最终版本另通过三档服务器冒烟及独立进程微基准。两份指纹分别记录，不把旧测量标成新源码。详见 [实现与开销报告](diagnostics-review-2026-10-20.md) / [JSON](diagnostics-review-2026-10-20.json)。
- 本地证据在忽略的 `framework/work/diagnostics-2026-10-20`；服务器在 `/opt/dou-bot-capacity/diagnostics-2026-10-20-f8dde93`，初始 `checkout` 与修正后的 `final` 均保留。34 份远端原始文件已核对 SHA-256；本轮单元、observer 和 SSH 转发已结束，Nginx PID 989 与 PostgreSQL 状态正常。
- 新增 `npm run example:diagnostics`；分布式工具支持 `--diagnostics off|metrics|sampled`。后续可固定入站并发再做出站 32/64/128 对照，并独立补 WS 基准；真实 SQL、渲染和多日验证仍待开展。
- SDK 版本仍为 0.8.0、源码契约 2.0 未发布，业务示例、网站、技能维持 npm 0.8.0；本轮改动由本次提交收录，未推送、发布或部署真实服务。下面保留此前基线。

## Webhook 异步验签完成

- 使用 Node 内置异步验签，新增 `transport.verifyTimeoutMs`（默认 10 秒），无新增运行依赖。签名、原始字节与时间戳校验保留；完成后再次检查时效和关闭状态。
- `maxConcurrentRequests` 覆盖读取正文及未结束的原生验签；超时或断线不会提前释放名额。关闭取消等待，仍按统一关闭期限排空原生任务，迟到结果不得接纳消息。
- 在相同 1.5 核 / 1 GiB 配额与合成工作负载下，同步/异步各做 64/16、128/32 的 500/s 对照。异步 128/32 短测曾全部接纳 60,000 条，但 5 分钟复验仅完成 147,249 / 150,000，末段再次积压；不能写成稳定 500/s。
- 异步 128/32 的 400/s × 5 分钟全部接纳并完成 120,000 条，漏发 0，成功 P95 696 ms、P99 1,657 ms，尾队列中位 0。仅代表单账号、2,000 个合成群标识、内存持久化与本地模拟 API。
- 两版 Node 最终回归各 358 项（356 通过、2 项专用 DB 跳过）；当前 tarball、170 个导出、128 组类型契约通过，整体行覆盖率 96.79%。源码契约仍为未发布的 2.0、SDK 版本仍为 0.8.0。
- [实现与复验报告](webhook-async-review-2026-10-20.md) / [JSON](webhook-async-review-2026-10-20.json) 保存完整范围、失败结果及证据校验值。工作资料在忽略的 `framework/work/webhook-async-2026-10-20`；服务器新测试目录为 `/opt/dou-bot-capacity/webhook-async-2026-10-20-f8dde93`。
- 六轮正式测试与冒烟已结束，比较单元、observer 和 SSH 转发均已清理；Nginx PID 989 未变、PostgreSQL 就绪且未重启。未启动真实 QQ、SQL 负载，未提交、推送、发布或部署。
- 下一步独立补 WS 基准，并定位 HTTP、资源分配与缓存增长时的 CPU 成本；真实 SQL、业务接口、图片渲染及多日运行仍待独立验证。下面各节保留此前基线，不能用旧检查计数代替本轮结果。

## 分布式并发对照完成

- 用户授权将发压端移出服务器，按入站/出站 32/8、32/16、64/16、64/32 对照，后按实测补充 128/32、128/64；每档测量 120 秒、500/s、60,000 条首次事件。
- 六档完整性均通过、漏发为 0。接纳量分别为 33,144、41,057、48,492、46,795、55,044、54,155；末尾仍有约 2,000 条积压，没有继续测 1,000/s，也没有上调默认并发。
- 服务器 SDK、API 夹具和监督进程共享 1.5 核 / 1 GiB；源指纹一致。真实 SQL、QQ、Nginx/TLS、渲染未加入负载，不能把结果当作 WS 容量上限。
- 独立稳定段 CPU 采样约 39.29% 在同步 Webhook 验签调用链、约 6.43% 为 GC。它是优化候选依据，不是某项优化已经生效的证明。
- 详见 [并发报告](concurrency-review-2026-10-20.md) / [JSON](concurrency-review-2026-10-20.json)，操作见 [分布式基准指南](benchmark-distributed.md)。工具只扩展测试适配器的 outbound 类型入口，生产运行时和公开契约保持不变。
- 两版 Node 最终检查各 347 项：345 通过、2 项专用 DB 跳过；当前 tarball、170 个导出及 128 组类型契约通过。原始成功/失败记录、两份 CPU profile 和主机监测位于忽略的 framework/work/concurrency-2026-10-20 与 framework/work/distributed。
- 所有本轮比较单元、监控和 inspector 已结束；Nginx PID 989 未变，PostgreSQL 未重启、就绪。后续应先设计验签执行方式与资源分配优化、单独补 WS 基准，再用相同场景复测；不要关闭验签或减少保留窗口来制造容量提升。

## 目标服务器验收完成

- 用户授权在 root@43.143.160.168 先做合成容量压测，再做 65 分钟真实计时测试；同机 PostgreSQL 与 Nginx 未改动，不连接真实 QQ。
- 独立检出 `/opt/dou-bot-capacity/2026-10-20-f8dde93/checkout`，Node 24.21.0；整个测试进程组限 1.5 核、1 GiB，无 swap。
- 冒烟通过；完整阶梯负载高阶段发生压测端漏发，整轮完整性未通过。50/s 和 200/s 阶段无漏发、无采样积压；不得把更高阶段记为有效容量。
- 65 分钟测试于北京时间 01:42:57 开始、02:47:59 退出；84,300 条首次事件全部处理，3,372 次重复被去重，零拒绝；84 次失败全部为计划注入，无额外失败，受管资源全部归零。
- 持续测试最高分钟采样 RSS 153.9 MiB、堆 55.8 MiB；一小时后回复记录稳定在约 77,400 条。数据库仅观察资源，未承接真实 SQL 压测；图片渲染、QQ 配额和多日运行未验证。
- 完整结果见 [服务器验收](server-capacity-2026-10-20.md) / [JSON](server-capacity-2026-10-20.json)。原始证据、源码及归档在忽略目录 `framework/work/server-capacity/2026-10-20-f8dde93/`；19 份远端证据的本地副本已核对 SHA-256。
- 本轮验收及观察器单元已清理；本线程临时跟进（automationId 65）已 PAUSED。Nginx 保持 active，PostgreSQL 就绪、未重启，目录与证据保留。

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

正式版完成标准统一维护在 [发布待办](api-review-1.0.md#仍未完成的-10-门槛)，当前顺序：

1. **固定候选与 CI。** 核对环境和工作区，收录当前改动，按任务授权提交、推送；完整矩阵必须对应实际候选。
2. **补齐数据库容量与恢复。** 第一轮连接池、超时、断连、关闭排空及慢接口闭环专项已通过；继续验证真实 SQL 的固定速率接纳与整库不可用。使用独立测试环境，不得使用已失效的旧 TEST_DATABASE_* 或回退到业务数据库。
3. **补齐当前候选的真实 QQ 验收。** 重点为 WS 重连、WS/Webhook 混合接入和账号分流、进程重启与故障隔离；已有双 WS 和旧版 Webhook 证据分别保留。
4. **完成长期观察。** 先安排 24 小时模拟负载，再按结果扩展至 72 小时，并开展小范围真实业务多日试用；明确资源预算、成功标准和停止方式。
5. **适配用户入口。** 用候选 tarball 或 RC 验证 example、网站和 skill，补齐 Linux/Nginx/systemd 部署、监测、升级及回滚教程；发布后切换正式依赖。
6. **完成正式版收尾。** 冻结 API，明确兼容/弃用及交付承诺，完成 RC 与最终包验收；新版本不增加旧 SDK 迁移要求。

当前消息任务、去重和冷却仍在内存中；崩溃后未完成任务不自动恢复，持久化队列是否实现由交付承诺决定。750/s 暂不作为必须达到的发布指标，容量承诺依据完整链路实测。

长跑脚本位于 framework，`npm run soak -- 86400000` 表示 24 小时**模拟网络、真实计时**运行，不包含真实 PostgreSQL 或 QQ；数据库负载须使用对应专项工具。本交接没有启动长跑。

## 9. 给新设备助手的接续指令

> 请先阅读 framework/docs/handoff.md、framework/docs/repository.md、framework/docs/api-review-1.0.md 和根 README，核对 main 的最新提交、工作区和 CI。项目分为 framework、example、website；SDK 0.8.0 已发布，示例、网站和技能均使用 npm 0.8.0。保持 Node 24.x、TypeScript 5.9.3、轻量依赖与 QQ 官方群聊/私聊方向。
>
> 一切行为结论以实际测试为准，区分离线、公网合成与真实 QQ 证据；不以 QQ 官方 SDK 作为参考。0.8.0 公网 Webhook 收发、503/延迟后的自动重投、受控去重和 SDK 崩溃恢复已实测；新架构已完成真实双 WS 基本验收，当前候选的混合接入和故障补验仍待开展。跨重启会再次执行相同事件，已确认但未完成的任务未自动恢复；持久化接纳与跨重启去重尚未实现。
>
> 既有服务器探针、容量测试、观察器和 SSH 转发均已结束，HTTPS 与证据保留；automation 65 保持暂停。本机临时资料和 .env 不在 Git。先完成新设备离线恢复，再按正式版六项待办推进。真实 QQ、数据库负载、长跑、部署及 npm 发布按已确认范围执行；用户文档和技能保持简洁、面向使用者。

旧交接原文见 [历史交接存档](handoff-history-2026-10-13.md)。其中的旧版本、未发布措辞及旧待办只反映当时状态。
