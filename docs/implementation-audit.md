# dd-bot 当前实现审计

日期：2026-09-30。本表对应开发方案 1.7 和当前源码，目的是让已验证内容与剩余验收可逐项定位。测试数量、平台结果和性能原始数据以 [验证记录](./validation-report.md) 为准。

当前交付为 0.6.0，在已有类/方法 Guard 基础上增加模块统一配置和模块类装饰器支持。用户已确认首版以 Windows 验收，Webhook 先完成本地验证；模板模式已从范围中移除。本表按这些明确要求核对完成状态。

访问限制能力的证据为 access.test、api-validation.test 和扩展后的 WS/Webhook 对照测试；平台管理者按钮的实际拦截与不同角色账号的实机验收仍待执行，未沿用历史普通按钮验收代替。

prompt 验证由 prompts.test、独立消费者和扩展 WS/Webhook 对照测试覆盖；用户后续已确认一轮人工测试正常，具体记录与覆盖粒度见验证记录。

本轮模块 Guard 由 module-guards.test、独立消费者和 WS/Webhook 对照覆盖；不递归影响 imports。

## 用户要求与交付物

| 要求                                  | 当前证据                                                                                             | 状态                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| NestJS 风格装饰器、静态模块与构造注入 | contracts、metadata、container、dispatcher；core/application 测试；独立消费者执行真实 tsc 装饰器产物 | 已实现并本地验证                                    |
| 只接入 QQ 官方机器人，群聊与私聊      | 归一化仅生成 group/private 高级上下文；QQClient 两类路径；没有 Koishi/Satori 运行时依赖              | 已实现；两场景 WS 实机验证                          |
| WS 和 Webhook                         | 两个 transport，共用 Execution、Dispatcher、QQClient；transport-parity 测试比较实际 HTTP/WS 输入结果 | 本地验证；WS 实机通过；Webhook 公网按用户选择待部署 |
| 轻量、无热更新                        | 生产依赖仅 reflect-metadata 与 ws；静态初始化，没有 watch/reload 插件系统                            | 已实现；合成性能基线已记录                          |
| TypeScript 5.9.3                      | package.json、锁文件、实际编译与独立消费者检查                                                       | 已固定                                              |
| 完整开发方案、逐模块 API 与功能       | development-plan 的 20 节、public-api 1.7、技术选型、README、command-parameters、execution-controls  | 已提供并同步当前范围                                |
| Guard、冷却和完整业务示例             | UseGuards/CanActivate、Cooldown、examples/business、controls.test、business.test                     | 已实现并本地验证                                    |
| 无序参数与剩余参数                    | Slot/Rest、词序全排列、歧义/重复/缺参拒绝、原序保留；arguments.test 与 example:query                 | 已实现并离线验证                                    |
| 类型化参数、选项、帮助与错误提示      | Arg schema / Option / HelpModule / invalidInput；类型反例、应用测试及独立消费者                      | 已实现并离线验证                                    |
| 群聊无需 @、前缀可自定义或为空        | 应用测试与实际群/私空前缀指令；当前为单一前缀字符串                                                  | 已实现并实测                                        |
| 图片、原始 Markdown、内联按钮         | 消息构建及具名 API 测试；两场景实机图片/Markdown/按钮显示与确认                                      | 已实现并实测                                        |
| 点击后文案保留                        | visitedLabel 默认回退至 label；两场景复测及用户确认                                                  | 已修复                                              |
| 不使用模板 ID                         | 模板函数与类型分支移除，类型与运行时拒绝旧输入                                                       | 按用户最新要求完成                                  |

## 模块验证索引

| 模块                 | 主要证据                                           | 验证内容                                                                                              |
| -------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| 配置                 | core.test、application.test                        | 默认值、非法组合、容量约束、自定义/空前缀                                                             |
| 元数据与容器         | core.test、application.test                        | 模块隔离、菱形绑定、歧义、循环、参数装饰器、生命周期、工厂及 init 回滚                                |
| 分发与上下文         | application.test、transport-parity.test            | 别名、引号、this/DI、手动与自动回复、观察器隔离、消息序号、按钮确认失败后继续业务                     |
| 命令参数与帮助       | arguments.test、api-contract.types、独立打包消费者 | Slot / Rest / Option、旧模式兼容、类型与范围、声明错误、帮助隔离、错误回复和发送失败                  |
| 执行控制与业务模块   | controls.test、business.test、独立打包消费者       | Guard 顺序/DI/继承/拒绝、冷却并发/隔离/过期/容量、按钮确认、关闭取消、业务全流程                      |
| 队列、去重与操作跟踪 | application.test、time.test、ws.test               | 并发重复、过载回滚、未 await 发送、操作数限制、活跃保护、完成后 TTL、作用域等待、去重淘汰不重置序号   |
| Token                | token.test、time.test                              | 单航班获取、提前刷新、退避、保留有效旧凭证、拒绝非法有效期、迟到响应、关闭后无刷新                    |
| HTTP/QQApi           | http.test、time.test、api-validation.test          | 全部具名端点、同源路径、真实 fetch 不跟随重定向、响应大小、总超时、取消隔离、排空、业务错误及 traceId |
| 消息与键盘           | core.test、application.test、api-validation.test   | 文本、图片、原始 Markdown、三种按钮、快照、跨范围媒体拒绝、点击后文案、旧模板拒绝                     |
| WS                   | ws.test、实机 reconnect 探针                       | READY、两种心跳格式、RESUME、过载游标、无效会话、超大帧、关闭强杀、迟到帧、退避重置与启动次数上限     |
| Webhook              | webhook.test、transport-parity.test                | 原始字节验签、挑战限制、重复头、错误输入、慢 body、断开、名额、嵌入所有权、独立连接关闭、先确认再处理 |
| 生命周期与错误       | application.test、time.test、logging.test          | 启停竞态、绝对期限、资源回滚、HTTP 排空、错误回调超时/关闭、脱敏、logger 与异常对象故障               |
| 发布构建             | scripts/test-package.mjs、api-contract.types.ts    | 打包白名单、凭证扫描、独立解析依赖、生成声明、实际消费者运行                                          |

## 阶段退出条件核对

| 阶段            | 核对证据                                                                                                         | 结论                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------ |
| P0 工程与契约   | tsc 5.9.3 类型检查、生成 ESM 与声明、独立 tarball 消费者导入/运行、凭证与文件白名单检查                          | 通过                     |
| P1 模块与 DI    | 单例、显式 token、导出隔离、菱形图、循环、类型导入擦除、构造继承、异步工厂/初始化回滚测试                        | 通过                     |
| P2 离线业务链路 | 群/私指令、空前缀、非法返回、附件归一化、消息快照、去重、共享回复序号、字节/条数过载与控制任务测试；离线示例运行 | 通过                     |
| P3 QQ 客户端    | 所有首版具名端点及路径、认证头、上传/消息编码；HTTP/业务错误、重定向、大小、超时/取消、审核和范围错误测试        | 通过                     |
| P4 WS           | 模拟网关状态机、初始重试上限、心跳、会话恢复、游标冻结、旧帧、强制回收；实机 READY/RESUMED/ACK                   | 通过                     |
| P5 Webhook      | 原始字节签名、挑战、重复头、坏 JSON、错误隔离、先确认后处理、并发/字节限制、断开及独立/嵌入关闭测试              | Windows 本地验收通过     |
| P6 组合与文档   | WS/Webhook 同输入对照；可运行双模式示例；20 节方案、契约、技术选型、README、文档链接、构建和测试检查             | 通过                     |
| P7 实机联调     | 用户确认群/私文本场景、图片、原始 Markdown、按钮及空前缀；实机受控断线恢复；已记录平台差异和部署边界             | 按用户确认的首版范围通过 |

## 1.0 准备审查

本轮补齐 testing 入口的公开声明，新增 TestAdmission 类型，并将根入口和 testing 共 123 个导出、95 组类型双向检查接入 check。原 0.6.0 业务消费者分别在已发布包和当前 tarball 中编译运行，已有写法保持兼容。结论与边界见 [API 审查](api-review-1.0.md)。

持续运行脚本新增群聊/私聊三级 Guard、无序参数、别名冷却、多轮 prompt、取消、超时、问题发送失败和待回答时关闭。新增当前源码三分钟记录见 [组合验证](soak-validation-1.0-review.json)；原三分钟 393,088 个事件的数据保留为 0.1.1 历史结果，不与新负载直接比较吞吐。

npm 的 0.6.0 已正式公开发布，当前审查修改尚未发布新版本。公网 QQ Webhook、分角色账号实测、多日真实业务观察仍待后续验收；本轮没有启动真实 QQ 服务。
