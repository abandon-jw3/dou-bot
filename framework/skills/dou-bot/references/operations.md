# 使用数据服务与运行应用

## 数据库与 ORM

- `AppOptions.database` 必填 host、user、database、password；空密码显式传 `''`。
- 默认端口 5432、连接池 25、连接超时 5 秒、SQL 超时 10 秒。
- 首次部署单独调用 `migrateDatabase(database)`。普通启动检查结构，不自动建表或迁移业务数据。
- `database.schema` 默认 `dou_bot`，只指定框架表所在命名空间；业务表由自己的迁移管理。
- 注入 `Database` 使用参数化 SQL；连接池按应用共享，不随机器人数量倍增。

```ts
import { Database, Injectable } from 'dou-bot';

@Injectable()
export class Profiles {
  constructor(private readonly database: Database) {}

  async server(appId: string, scene: 'group' | 'private', userId: string) {
    const result = await this.database.query<{ server: string }>(
      'SELECT server FROM bot_profiles WHERE app_id = $1 AND scene = $2 AND user_id = $3',
      [appId, scene, userId],
    );
    return result.rows[0]?.server;
  }
}
```

- 将 Profiles 注册到业务模块的 providers；`bot_profiles` 是需要自行迁移创建的业务表。
- 示例用户配置按 appId、scene、userId 唯一；群内独立配置还需加入 groupId。
- 已有 ORM 沿用项目方案。支持 node-postgres 的 ORM（如 Drizzle）可复用 `Database.pool`，在业务 Service 中封装。
- 复用框架池时不要调用 ORM 的断开方法或 `pool.end()`；单独创建的业务连接池由业务负责关闭。
- 手动 `pool.connect()` 借用连接后，在 finally 中归还。
- `database.transaction(async client => { ... })` 内所有查询使用该 client；ORM 事务使用其 tx 对象。
- 事务失败不自动重试，外部 HTTP 放在事务之外；取消信号也不意味着已提交的数据会回滚。
- 框架保存群地址和发送归属；业务表、订阅、任务持久化与幂等由应用负责。

## 排查延迟与排队

| 想知道什么                     | 查看哪里                                                                |
| ------------------------------ | ----------------------------------------------------------------------- |
| 哪个账号可用、共享队列是否积压 | `app.snapshot()`                                                        |
| 某个账号的等待、拒绝和缓存     | `app.bots.get(appId).snapshot()`                                        |
| 中间件、业务或 QQ 请求哪个慢   | 开启 `diagnostics.enabled`，查看 `app.diagnostics.snapshot()`           |
| 需要导出采样记录               | 配置 `diagnostics.onSpans`，或用 `app.diagnostics.takeSpans()` 取走采样 |

- 先看排队、拒绝和数据库连接等待，再比较 `handler.invoke`、`context.load`、`qq.http`。
- 阶段耗时包含 I/O，不等于 CPU；P95/P99 为直方图桶上界，并行阶段不可相加。
- 诊断默认关闭。启用导出时关注 `droppedMeasurements`、`droppedSpans`、`exportDisabled`。
- 按应用真实接口、SQL 和渲染负载调参；积压时先找瓶颈，再决定并发和队列大小。
- 日志不记录凭证、完整消息或 SQL 参数，不将用户与群列表加入观测标签。

## 部署应用

- 固定依赖和锁文件，构建后运行 JavaScript；工作目录、环境文件和启动命令使用应用自己的配置。
- 首次部署先执行迁移；停止时处理 SIGTERM 并等待 `app.close()`。
- 启动后检查账号状态，再验证真实收发；进程存活不等于机器人在线。
- Webhook 代理保留原始正文和签名头，公网入口使用平台接受的端口，例如 HTTPS 443。
- 重启会清空内存队列、prompt、冷却和去重；重要任务需业务持久化。
- 按本次任务已确定的环境和范围执行真实数据库、接口及 QQ 验证，方法见 [测试与排错](testing.md)。
