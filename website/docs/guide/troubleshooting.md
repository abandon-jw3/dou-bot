# 错误与排查

先区分“没有连接”“没有收到事件”“没有匹配处理器”和“发送被拒绝”。默认日志、onError 和 app.snapshot 可以帮助定位阶段。

| 现象                         | 优先检查                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------- |
| 启动即 CONFIG                | 必填配置、字段名、互斥的 transport 字段、资源容量关系                            |
| DEPENDENCY                   | 服务是否 Injectable、是否注册、imports/exports、接口是否有 Inject 令牌           |
| ROUTE_CONFLICT               | 命令名或别名重复，是否和 HelpModule 的 help/帮助 冲突                            |
| 有连接但命令无响应           | 前缀、Controller 注册、平台投递权限、Guard 是否静默拒绝                          |
| 群里不 @ 无响应              | 该账号是否收到普通群消息；不要把一个账号的能力推广到所有账号                     |
| Slot 输入报错                | 字典是否包含该词、是否重复命中或歧义、必要参数是否缺失                           |
| 管理员命令拒绝               | 当前事件有没有 member_role，是否为精确的 admin/owner；不要用 QQ 号推测角色       |
| 按钮点击已确认却没有业务消息 | ACK 仅表示收到；检查回调 ID、data、Guard 和平台普通发送权限                      |
| prompt 看似卡住              | 是否 await、同用户是否已有等待、QQ 是否投递回答、测试是否错误地先 await dispatch |
| Webhook 验签失败             | Secret、原始请求体、签名头、URL、时间偏差和代理行为                              |
| 关闭超时                     | 销毁钩子、业务外部请求和未配合 signal 的异步任务                                 |

## 装饰器编译问题

开启 experimentalDecorators 和 emitDecoratorMetadata，用 tsc 生成 JS 后运行。构造注入的类使用值导入；接口配置使用显式 Inject。不要把默认转译工具的“可以运行 TS”理解为一定生成所需元数据。

## 请求失败时记录什么

QQApiError 提供 httpStatus、qqCode、traceId、method、path 等字段。ErrorContext 提供 phase 及可用的处理器位置。记录这些字段通常比记录整个 raw 事件更有帮助。

框架不会把失败发送简单自动重试成另一条消息；业务需要结合平台结果决定是否重试并防止重复操作。pending-audit 不代表发送失败，也不表示审核已通过。

## 如何反馈

到 [公开文档仓库 Issues](https://github.com/abandon-jw3/dou-bot-docs/issues) 提供 SDK/Node/TypeScript 版本、WS 或 Webhook、最小代码与错误阶段。不要提交 AppSecret、access_token 或完整身份数据。文档问题也可以点击页面底部的编辑链接修正。
