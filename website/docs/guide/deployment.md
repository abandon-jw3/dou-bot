# 部署与升级

将自己的机器人应用部署到服务器，配置进程重启、日志和正常关闭。

## 构建与数据库

```sh
npm ci
npm run check
npm run build
npm run database:migrate
npm start
```

- 以上脚本由 [业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/example) 提供；快速开始项目用 `node --env-file=.env dist/main.js --init-database` 迁移。
- 首次部署先创建数据库，再显式迁移；普通启动不建表。
- 将完整应用目录、锁文件和 dist 一起部署，在目标环境运行 npm ci 安装依赖。
- .env 只保存在部署环境。生产账号按业务所需权限配置。

## Linux / systemd

以下示例假设项目位于 `/opt/qq-bot`，Node 安装在 `/usr/bin/node`，已有系统用户 `qqbot`。先确认路径，再创建 `/etc/systemd/system/qq-bot.service`：

```ini
[Unit]
Description=QQ bot application
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=qqbot
WorkingDirectory=/opt/qq-bot
ExecStart=/usr/bin/node --env-file=/opt/qq-bot/.env /opt/qq-bot/dist/main.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
```

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now qq-bot
sudo systemctl status qq-bot
sudo journalctl -u qq-bot -f
```

- 关闭期限应大于 `execution.shutdownTimeoutMs`，给应用留出排空时间。
- Webhook 使用 [Nginx 代理配置](./webhook.md#反向代理)，确认平台能完成回调验证。
- 多个账号共用进程；同一账号不要同时由另一个 WS 实例接入。

## Windows

- 使用同一套 npm ci、build、迁移和 start 命令。
- 常驻服务指定工作目录、环境文件及重启策略。
- 保留 SIGINT/SIGTERM 到 app.close() 的处理，前台测试用 Ctrl+C 关闭。
- 开发时用 npm run dev；生产运行构建后的 JavaScript。

## 日常监测

- 进程存活不代表账号在线：看 app.status 和每个账号的 status。
- 检查入站/出站积压、拒绝数、SQL 池等待、错误率、CPU 和内存。
- 应用 degraded 时定位受影响账号；数据库共享故障影响整个应用。
- 详细指标见 [容量监测](./capacity.md) 与 [性能观测](./diagnostics.md)。

## 更新与回退

1. 在测试环境更新依赖并保存锁文件，完成构建、测试和数据库备份。
2. 停止旧进程，按版本要求迁移，然后启动新进程。
3. 确认账号状态，并实际发送指令验证结果。
4. 回退前核对数据库结构兼容性，再恢复上一版包、锁文件和构建产物。

- 代码回退不会自动回退数据库；结构不兼容时拒绝启动。
- 重启会清空消息队列、对话、冷却和去重，不能恢复未完成任务。
- 重要写入应有业务幂等键；后台任务是否持久化由业务要求决定。
