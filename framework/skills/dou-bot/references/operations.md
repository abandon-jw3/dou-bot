# 数据与运行

## PostgreSQL

- AppOptions.database 必填 host/user/database/password；空密码明确传空字符串。
- 默认端口 5432、池 25、连接超时 5 秒、SQL 超时 10 秒。
- 首次显式 migrateDatabase；正常启动只检查结构，缺失或不兼容报 DATABASE_SCHEMA。
- 注入 Database；query(sql, values) 使用参数化 SQL，transaction 在同一 client 中执行。
- 事务失败不自动重试；外部 HTTP 不放在持锁事务中。
- pool 由框架关闭；手动借用连接需归还，不调用 pool.end()。
- 框架只持久化群地址和归属；业务表、备份、订阅及幂等由业务负责。
- 真实 SQL 验证使用用户指定的测试环境，先确认目标与数据范围。

## 观测

- app.snapshot()：共享 inbound/outbound、database 等待与各 bots 状态。
- bots.get(appId).snapshot()：该账号的队列、prompt、缓存、拒绝和累计耗时。
- diagnostics.enabled 默认 false；开启后用 app.diagnostics.snapshot()。
- 先看排队/拒绝，再比较 handler.invoke、context.load、qq.http 和 SQL 等待。
- 阶段耗时包含 I/O，不等于 CPU；P95/P99 是直方图桶上界，不能把并行阶段相加。
- onSpans 可异步导出；或者 takeSpans 手动取走采样。留意 droppedMeasurements、droppedSpans、exportDisabled。
- 不把消息正文、凭证、群/用户列表或 SQL 参数写入观测标签。

## 部署检查

- 编译后运行 JavaScript；保留固定包、锁文件和构建产物。
- 明确工作目录、环境文件与 SIGTERM → app.close 的关闭流程。
- 先迁移、启动，再测试真实收发；进程存活不代表账号在线。
- Webhook 代理保留原始请求字节和签名头，公网部署优先使用已验证的 HTTPS 443 入口。
- 重启丢失内存队列、prompt、冷却和去重；关键任务是否持久化取决于业务要求。
- 已有容量样本不代表用户的接口、SQL、图片渲染或 QQ 配额。按实际负载验证，不随意调大并发或缩短去重窗口。
