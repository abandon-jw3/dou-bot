# 本机双机器人 WS 验收

当前源码探针，不属于已发布的 npm 0.8.0 示例。仅接入两个 QQ 机器人和指定测试库；外部推送源使用本机 WS 夹具。

## 配置

- 真实配置写入 `framework/.env`，该文件被 Git 忽略。
- 字段示例见 [配置模板](../examples/multi-bot.env.example)。不要把凭证写入模板。
- 填写 `QQ_APP_ID_A/B`、`QQ_APP_SECRET_A/B`，以及新专用测试库的 `DATABASE_*`。
- `DATABASE_HOST` 只填域名或 IP，不带 `http://`、路径或端口；端口单独填入 `DATABASE_PORT`。
- 指定 `DATABASE_SCHEMA`；迁移与运行只使用此配置，不读取旧 TEST_DATABASE_*，也不回退到业务项目的环境。
- schema 名使用小写字母、数字和下划线，以字母或下划线开头，最长 63 个字符，例如 `dou_bot_acceptance`。
- 两个机器人均停止其他运行实例后再开始。探针默认 15 分钟自动退出。

## 启动

在 framework 目录执行：

```sh
npm run probe:multi-bot -- --check
npm run probe:multi-bot -- --migrate
npm run probe:multi-bot
```

- `--check` 只校验配置和模块，不连接 QQ 或数据库。
- `--migrate` 显式创建/检查框架结构，只连接指定测试库。
- 正常启动后打印本轮验证码和命令，例如 `/多机验收 1234abcd`。
- 连接池由应用共享，上限为 4；连接与 SQL 超时为 5 秒。账号仅需测试 schema 对应的迁移/读写权限。

## 实测步骤

1. 分别私聊 A、B 发送本轮命令，确认收到对应账号标记的回复。
2. 在同一个测试群分别 @A、@B 发送同一命令，确认两边回复。
3. 控制台输入 `routes`，检查两个账号的群地址解析结果均为 matches=true。
4. 输入 `push`，由本机 WS 消息触发 MessageSender 向两个已登记群地址发送；在 QQ 确认发送账号正确。
5. 输入 `stop A`，再输入 `push`：A 应报告 BOT_UNAVAILABLE，B 应继续发送。
6. 输入 `start A`，再输入 `push`，确认 A、B 均恢复发送且共享服务未重建。
7. 输入 `quit` 关闭。`status` 可随时查看账号状态和脱敏接收记录。

每个账号、每种场景只绑定本轮首个验证码匹配的会话和用户。其他会话不会被该探针回复；主动发送仅使用本轮已成功回复的两个群地址，不合并不同账号的 OpenID。

## 结果

- 报告写入被忽略的 `work/live-multi-bot/<验证码>/report.json`。
- 只记录账号标签、状态、错误码和地址摘要，不保存原始消息、OpenID、密码或 Token。
- `sent` 仅代表 API 发送结果；QQ 客户端是否收到、是否确实为同一物理群，需人工确认。
- 本轮不验证公网 Webhook、进程崩溃后的任务恢复或多日运行。它们仍是独立验收项。
