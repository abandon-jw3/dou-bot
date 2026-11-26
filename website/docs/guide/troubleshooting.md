# 错误与排查

按错误阶段排查，结合日志、`onError` 和 `app.snapshot()` 查看原因。

| 现象                         | 优先检查                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| 启动即 CONFIG                | 必填配置、字段名、互斥的 transport 字段、资源容量关系                            |
| DEPENDENCY                   | 服务是否 Injectable、是否注册、imports/exports、接口是否有 Inject 令牌           |
| ROUTE_CONFLICT               | 命令名或别名重复，是否和 HelpModule 的 help/帮助 冲突                            |
| 有连接但命令无响应           | 前缀、Controller 注册、平台投递权限、Guard 是否静默拒绝                          |
| 群里不 @ 无响应              | 先 @机器人重试，再确认该账号是否有普通群消息投递权限                             |
| Slot 输入报错                | 字典是否包含该词、是否重复命中或歧义、必要参数是否缺失                           |
| 管理员命令拒绝               | 当前事件有没有 member_role，是否为精确的 admin/owner；不要用 QQ 号推测角色       |
| 按钮点击已确认却没有业务消息 | ACK 仅表示收到；检查回调 ID、data、Guard 和平台普通发送权限                      |
| prompt 看似卡住              | 是否 await、同用户是否已有等待、QQ 是否投递回答、测试是否错误地先 await dispatch |
| Webhook 验签失败             | Secret、原始请求体、签名头、URL、时间偏差和代理行为                              |
| 关闭超时                     | 销毁钩子、业务外部请求和未配合 signal 的异步任务                                 |

- DATABASE_SCHEMA：先显式迁移，检查 schema 和数据库结构版本。
- DATABASE：检查连接、权限、SQL 超时与连接池等待。
- ROUTE_NOT_FOUND / ROUTE_AMBIGUOUS：保存完整 BotTarget 或显式绑定群归属。
- BOT_UNAVAILABLE / degraded：查看目标账号状态；不要换用另一机器人的 OpenID。
- 持续排队：检查入站、出站、数据库及 [阶段耗时](./diagnostics.md)。

## 装饰器编译问题

- 开启 `experimentalDecorators`、`emitDecoratorMetadata`。
- 用 tsc 编译后运行，确保生成所需元数据。
- 构造注入的类使用值导入，接口配置使用 `@Inject(token)`。

## 请求失败时记录什么

- QQApiError：记录可用的 httpStatus、qqCode、traceId、method、path。
- ErrorContext：记录 phase 和处理器位置。
- 重试前判断是否可能重复操作；`pending-audit` 表示等待审核。

## 如何反馈

在 [项目 Issues](https://github.com/abandon-jw3/dou-bot/issues) 提供：

- SDK、Node.js、TypeScript 版本及接入方式。
- 最小复现代码、预期结果、实际结果和错误阶段。
- 去除 AppSecret、access_token 和真实身份数据的日志。
