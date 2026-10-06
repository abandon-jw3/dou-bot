# 测试入口 API

导入路径为 dou-bot/testing。此入口使用模拟 QQ 网络，但业务中的任意外部 fetch 仍需由你替换。

## createTestApplication

```ts
createTestApplication(root: Type, options?: TestOptions): Promise<TestHarness>
```

root 为模块类。options 保留普通 BotOptions 的业务、日志、执行和 prompt 配置，移除 appId、secret、transport 后重新提供可选 appId，以及 respond 回调。appId 默认 offline-app，凭证和接入由测试工具内部替换。

返回的应用仍需 `await harness.app.start()`，结束时 `await harness.app.close()`。

<<< @/../examples/offline.ts

## TestHarness

| 成员              | 用途                                                            |
| ----------------- | --------------------------------------------------------------- |
| app               | BotApplication，用于启动、关闭与读取服务                        |
| messages          | 默认模拟发送的只读 RecordedMessage 数组，包含 target 和 payload |
| acknowledgments   | 交互确认记录，包含 interactionId 和 code                        |
| errors            | 错误与 ErrorContext 记录                                        |
| enqueue(payload)  | 同步接纳 QQDispatch，返回状态及可用的完成 Promise               |
| dispatch(payload) | 等待该接纳流程结束，再返回接纳状态                              |
| flush()           | 等待所有在途工作完成                                            |

enqueue 结果为 accepted/duplicate 时带 done: Promise&lt;void&gt;；ignored、overloaded、stopping、failed 时没有 done。duplicate 共享原流程的完成 Promise。done 不代表业务成功，仍应检查 errors 和实际发送结果。

需要为 enqueue 的结果声明类型别名时，使用 `ReturnType<TestHarness['enqueue']>`。

## respond 与 TestRequest

respond(request) 可以返回 Response、Promise&lt;Response&gt; 或 undefined。undefined 使用默认模拟行为；提供响应则覆盖该请求，而且不进入默认发送记录。

TestRequest 提供 method、URL 类型的 url、unknown 类型的 body 和 Headers。可以按 URL 路径模拟消息发送错误，同时让 token 等其他请求使用默认处理。

## 对话注意事项

dispatch 和 flush 会等待未结束的 prompt。先 enqueue 起始命令，观察问题记录，再投递后续回答；所有回答的 done 都可能等到父流程结束才完成。

完整实例与断言见 [离线测试](../guide/testing.md) 和 [两轮问答](../examples/prompt.md)。内存记录适合短测试，不应作为生产日志或无限增长的长跑存储。
