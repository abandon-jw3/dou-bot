# 错误、日志与类型

错误处理应依据 code 和 ErrorContext.phase，不把提示文案当成稳定协议。

## FrameworkError

```ts
new FrameworkError(code: FrameworkErrorCode, message: string, options?: ErrorOptions)
```

继承 Error，提供只读 code。options 可携带 cause。常见分类：

| code                              | 含义                             |
| --------------------------------- | -------------------------------- |
| CONFIG                            | 配置或声明不合法                 |
| DEPENDENCY                        | 缺失、歧义、循环或不可见依赖     |
| ROUTE_CONFLICT                    | 命令、别名或路由冲突             |
| PARAMETER_PARSE                   | 输入解析、类型、缺参或匹配错误   |
| HANDLER_CONTRACT                  | 处理器、消息或回调返回不符合约定 |
| PROTOCOL / TRANSPORT              | 平台协议或接入问题               |
| QQ_API                            | QQ HTTP / 业务接口错误           |
| QUEUE_FULL / RESOURCE_LIMIT       | 队列或其他受管资源达到上限       |
| INVALID_STATE                     | 已关闭上下文、重复等待等状态错误 |
| SHUTDOWN_TIMEOUT / CLEANUP_FAILED | 关闭超时或资源销毁失败           |

## QQApiError

QQApiError 继承 FrameworkError，code 为 QQ_API，name 为 QQApiError。构造参数为 message 和 details，其中 method、path 必填，httpStatus、qqCode、traceId、cause 可选。

捕获后可以用 instanceof QQApiError 区分协议请求失败，再读取可用字段。不要假定每次错误都有 HTTP 状态或 traceId。

## ErrorContext 与 onError

ErrorContext 提供 phase、appId，以及可选的 eventName、eventId、messageId、controller、method。阶段包括 bootstrap、transport、protocol、queue、observer、command、button、send、interaction-ack、guard、cooldown、prompt、shutdown。

onError(error, context) 可以同步或异步。默认回调期限 1000ms；超时后当前应用禁用该自定义回调，使用兜底日志。回调抛错不会递归调用自己。

正常 Guard 拒绝不是错误。受管操作失败即使被业务 catch，也可能已经由错误渠道记录。errors 中有记录、接纳结果为 accepted，以及用户收到错误提示，可以同时成立。

## Logger 与 LOGGER

Logger 提供 debug、info、warn、error，签名均为 `(message: string, fields?: Readonly<Record<string, unknown>>) => void`。通过 options.logger 提供实现，或通过 `@Inject(LOGGER)` 注入框架日志令牌。

<<< @/../examples/events/app.module.ts

保留必要的事件名、阶段与业务状态即可，避免把原始消息、身份列表和凭证写入日志。更多排查步骤见 [排错指南](../guide/troubleshooting.md)。
