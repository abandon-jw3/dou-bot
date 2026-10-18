# 多机器人重构验收（2026-10-18）

状态：源码与本地验收完成，未提交、未发布。分支 codex/multi-bot-runtime。基线 main / 07d2c3e，保留此前未提交的 Webhook 修复和 Benchmark。

## 新版本约定

- 所有者已确认：作为新的开始，不提供旧 SDK 的迁移路线，不以旧项目兼容性限制设计。
- 新包验收仅覆盖当前契约；下方旧发布包测试结果作为已经执行的历史事实保留。
- 数据库初始化与结构版本管理属于新框架能力，仍使用显式的 migrateDatabase。

## API 审查

| 范围       | 处理                                                                                 |
| ---------- | ------------------------------------------------------------------------------------ |
| 启动       | 移除 BotFactory、BotApplication；使用 AppFactory、Application、AppOptions            |
| 账号       | BotOptions 仅描述账号；新增 BotManager、BotHandle、BotStatus、BotSnapshot            |
| 目标       | MessageTarget 保留本账号目标；BotTarget 包含 appId；ctx.target 使用完整地址          |
| 推送       | 新增 MessageSender、GroupRoutes；不默认注入 QQClient/QQApi                           |
| 数据库     | Database、DatabaseOptions、migrateDatabase；pg 8.23.1，公共类型配套 @types/pg 8.23.1 |
| 生命周期   | 增加 OnApplicationReady / OnApplicationStopping；模块生命周期保留                    |
| 容量       | 新增独立出站预算及快照；入站执行名额由应用共享                                       |
| 业务装饰器 | Command、OnButton、OnAttachment、参数、Guard、身份与上下文中间件保持语义             |
| 测试       | 单账号视图复用新运行时；新增 createMultiTestApplication；内存持久化仅在 testing 入口 |
| 错误       | 新增数据库、归属和账号不可用错误；应用级错误可无 appId                               |

完整名称及类型由 public-api.d.ts / testing-api.d.ts 独立契约核对。[逐项 API 清单](api-audit-2.0.json) 覆盖全部入口：125 项保留、21 项调整、24 项新增、2 项移除。源码契约为 2.0，npm 包版本仍为 0.8.0。

## 验证记录

- 已通过真实 PostgreSQL：随机 schema 迁移、并发迁移/记录、事务回滚、重启恢复、结构版本拒绝、连接池归还与关闭。
- 已通过多机器人离线专项：共享 Provider、不同 OpenID 选路、歧义拒绝、显式绑定、账号独立停止/恢复、队列公平性、prompt 隔离、图片归属、混合 WS/Webhook、一条外部 WS 推送到两个模拟账号。
- Node 24.0.0、24.21.0 完整 check 均通过：321 项测试，319 通过，2 个数据库集成项在默认离线运行时跳过；两版 Node 的真实 PostgreSQL 专项另行 3/3 通过。
- 根入口与 testing 入口：170 个导出、128 组双向类型检查；当前 tarball 独立消费者、发布版 0.6.0 / 0.7.0 / 0.8.0 消费者均通过。
- 覆盖率：行/语句 96.41%，分支 90.41%，函数 93.76%。数据库专项独立执行，不混入默认离线覆盖率。
- 30 秒持续模拟通过，未发现非预期错误；执行队列、回复记录、prompt、信号和定时器在关闭后归零。
- 两小时虚拟时间容量测试通过：2,000 个模拟群、154,800 次新请求；含 155 次有意注入的发送失败，未出现额外容量拒绝。
- 配套 example 的 44 个、website 的 88 个、skill 的 15 个 Git 文件与原工作区逐文件一致。历史 Benchmark 原始 JSON 保持不变。
- 原基线 CI 的 9 个任务成功；当前改动未推送，新的 Windows/Linux CI 尚未执行。已保留原矩阵，并加入独立 PostgreSQL 专项。

完整测量及源码指纹见 [验收 JSON](multi-bot-refactor-2026-10-18.json)。

## 性能与资源成本

- 同机 Apple M4 / Node 24.21.0，迁移前后各五轮串行合成测试；没有真实 QQ 网络或 PostgreSQL。
- 最终轻量场景吞吐比基线下降约 3%～11%；空指令约 10.6 万次/秒、模拟回复约 3.9 万次/秒。这是本地夹具结果，不能换算成 QQ 配额。
- 新增共享预算、公平调度、发送跟踪和取消传播有实际成本。已消除共享队列热路径的数组分配，使用常量时间等待数统计，已学习群地址不重复执行数据库准备。
- PostgreSQL 自动选路使用一条 SQL 同时读取显式归属和候选，减少一次往返并保持同一查询快照。单独的数据库时延样本包含当前网络 RTT，详情见 JSON。
- 数据库学习失败仍允许明确目标的回复；自动路由失败不会换账号或回退内存。
- Webhook 监听端口冲突只使相应账号失败，WS 账号继续工作；端口释放后可单独恢复，业务服务不会重复构造。

## 边界

- 没有运行真实双机器人 QQ 联调；单机器人历史记录不能替代本次重构的真实平台验收。
- 没有消息持久化队列、跨进程去重、跨机器人同群映射或自动故障转发。
- 历史 JSON 和源码指纹不改写。新压测只与相同本地工作负载比较。
