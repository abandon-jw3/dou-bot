# PostgreSQL

配置共享连接池，在自己的 Service 中查询数据。

## 配置与迁移

- 必填：`host`、`user`、`database`、`password`。空密码需要明确传入 `''`。
- 默认：端口 5432、连接池 25、连接超时 5 秒、SQL 超时 10 秒、空闲连接超时 30 秒。
- SSL 默认关闭；远程连接可配置 `ssl: true`，或提供 CA 配置。
- 框架默认使用独立 `dou_bot` schema，可通过 `schema` 修改。
- 配置不会自动读取其他 PostgreSQL 环境变量。

```ts
import { migrateDatabase } from 'dou-bot';
await migrateDatabase({
  host: '127.0.0.1',
  user: 'bot',
  database: 'bot',
  password: process.env.DATABASE_PASSWORD!,
});
```

迁移需单独执行。操作使用事务和数据库锁，可重复运行；不兼容的结构版本会拒绝启动。

## 在服务中使用

```ts
import { Database, Injectable } from 'dou-bot';

@Injectable()
export class Profiles {
  constructor(private readonly database: Database) {}

  async server(
    appId: string,
    scene: 'group' | 'private',
    userId: string,
  ): Promise<string | undefined> {
    const result = await this.database.query<{ server: string }>(
      'SELECT server FROM bot_profiles WHERE app_id = $1 AND scene = $2 AND user_id = $3',
      [appId, scene, userId],
    );
    return result.rows[0]?.server;
  }
}
```

- 使用参数化 SQL；示例 bot_profiles 表由业务迁移创建，主键包含 app_id、scene、user_id，server 为文本字段。
- 多条 SQL 的事务使用 `db.transaction(async client => { ... })`；同一事务使用同一个 client。
- 事务失败通过 Promise 返回，框架不会自动重试回调。外部接口请求尽量放在事务之外，减少连接占用。
- 可以把 `db.pool` 交给支持 node-postgres 的 ORM，例如 Drizzle。框架不绑定 ORM。
- 手动 `pool.connect()` 后必须归还连接；不要调用 `pool.end()`，最终关闭由框架负责。
- 默认连接池上限按应用计，不按机器人数量倍增。

## 错误与关闭

- `DATABASE_SCHEMA`：结构缺失、不完整或版本不支持，检查显式迁移。
- `DATABASE`：连接、认证、权限或查询失败，检查数据库服务与配置。
- 关闭时先等待在途工作；超过总期限会断开连接，包括尚未完成认证的连接。

## 保存范围

- 保存机器人 AppID、账号下的群 OpenID、显式发送归属。
- 不保存 Secret、Access Token、消息正文、角色快照。
- 不保存消息任务、冷却或执行去重。
- 运行时数据库失败会报告错误；选路不回退为随机账号。目标账号已明确时，QQ 回复与发送仍按该账号状态处理。
