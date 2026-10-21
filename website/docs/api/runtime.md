# 数据库与观测 API

## Database

- 注入 Database，使用 `query<R>(sql, values?)` 执行参数化 SQL。
- `transaction(run)` 在同一连接内执行回调；失败回滚，不自动重试。
- pool 为框架管理的 node-postgres Pool；借用连接需释放，不能调用 pool.end()。
- schema 是框架表所在 schema；业务表由自己的迁移管理。
- `migrateDatabase(options)` 显式初始化框架结构；见 [数据库指南](../guide/database.md)。

## DiagnosticsReader

| 方法        | 返回                                             |
| ----------- | ------------------------------------------------ |
| snapshot()  | DiagnosticsSnapshot，累计阶段指标与丢弃/导出状态 |
| takeSpans() | readonly DiagnosticsSpan[]，取走当前待消费采样   |

- 从 app.diagnostics 获取，默认关闭；配置见 [性能观测](../guide/diagnostics.md)。
- metric 包含阶段、账号、处理器、计数、耗时、在途数量、结果计数与直方图。
- span 包含本地 traceId/spanId、阶段和耗时，不使用 QQ 用户或消息 ID。
- snapshot 中的桶为非累计桶；末桶代表超出上界。
- 完整字段见 [DiagnosticsOptions](./types.md#root-DiagnosticsOptions)、[DiagnosticsMetric](./types.md#root-DiagnosticsMetric)。
