# PostgreSQL 数据库

框架需要 PostgreSQL，用于保存账号下的群地址和发送归属；所有机器人共用一个连接池。

## 首次初始化

- 准备数据库及具备建表权限的账号，在本地环境中配置连接参数。
- 执行 `migrateDatabase(database)`；[快速开始](./quick-start.md) 的入口提供 `--init-database`。
- 正常启动只检查结构，不自动建表；缺少结构时报 `DATABASE_SCHEMA`。
- 默认 schema 为 `dou_bot`，可通过 `database.schema` 指定。
- 迁移使用事务和数据库锁，可重复执行；备份与权限仍由部署环境管理。

## 连接选项

| 字段                           | 默认值 / 要求                          |
| ------------------------------ | -------------------------------------- |
| host、user、database、password | 必填；空密码明确传 `''`                |
| port                           | 5432                                   |
| max                            | 25，整个应用共用                       |
| connectionTimeoutMs            | 5000                                   |
| statementTimeoutMs             | 10000                                  |
| idleTimeoutMs                  | 30000                                  |
| ssl                            | false；远程连接按环境配置 `true` 或 CA |

框架不自动读取 PostgreSQL 环境变量；在应用入口把环境配置传给它。

## 查询业务数据

服务注入 `Database`，使用参数化 SQL。以下业务表需由自己的迁移创建：

```sql
CREATE TABLE bot_profiles (
  app_id text NOT NULL,
  scene text NOT NULL,
  user_id text NOT NULL,
  server text NOT NULL,
  PRIMARY KEY (app_id, scene, user_id)
);
```

<<< @/../examples/database/profiles.service.ts

- 将服务注册到模块的 providers；调用时传入 `ctx.appId`、`ctx.scene` 和 `ctx.userId`。
- 主键包含账号和场景；不要自动合并不同场景的身份。
- 事务使用 `db.transaction(async client => { ... })`，同一事务始终使用传入的 client。
- 失败会拒绝 Promise，不自动重试事务；网络请求尽量放在事务之外。
- `db.pool` 可交给支持 node-postgres 的 ORM。手动借用连接需归还，不调用 `pool.end()`。

## 保存与关闭边界

- 框架保存 AppID、群 OpenID 和显式归属；不保存 Secret、Token 或消息正文。
- 消息队列、去重、冷却和 prompt 仍在内存中；重启不会恢复未完成任务。
- 连接故障报 `DATABASE`；关闭超过总期限会中止未完成 SQL。
- 连接池等待数见 [容量监测](./capacity.md)。
