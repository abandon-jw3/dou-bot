# 测试入口 API

从 `dou-bot/testing` 导入。使用内存持久化和模拟 QQ 网络，不需要真实凭证或数据库。

## createMultiTestApplication

```ts
createMultiTestApplication(root: Type, options?: MultiTestOptions): Promise<MultiTestHarness>
```

- bots 指定测试账号，默认一个 offline-app；不填写 Secret。
- 支持应用的业务配置、执行/出站预算和 diagnostics。
- `respond(request)` 可替换 QQ HTTP 响应；业务自己的网络/SQL 仍需注入替身。

| 成员                     | 用法                              |
| ------------------------ | --------------------------------- |
| app                      | 与正式 Application 相同的公开接口 |
| dispatch(appId, payload) | 投递并等待完成，返回接纳状态      |
| enqueue(appId, payload)  | 立即返回接纳结果，适合 prompt     |
| flush()                  | 等待当前工作排空                  |
| messages                 | 每条含 appId、target、payload     |
| acknowledgments          | 按钮确认记录                      |
| errors                   | 错误及阶段记录                    |

完整例子见 [双账号测试](../examples/multi-bot.md)。

## createTestApplication

```ts
createTestApplication(root: Type, options?: TestOptions): Promise<TestHarness>
```

- 单账号测试视图，dispatch/enqueue 不需要 appId。
- `h.app` 为 TestApplication；snapshot 返回一个 BotSnapshot，不是应用汇总。
- `h.app.client` 是测试便利入口，正式 Application 不提供这个成员。
- messages 不带 appId；需要验证账号选择时使用多账号入口。

## TestHarness

两种入口都遵循以下接纳规则：

| status                                   | 含义                              |
| ---------------------------------------- | --------------------------------- |
| accepted / duplicate                     | 有 done Promise；可等待原执行完成 |
| ignored / overloaded / stopping / failed | 本次未开始新执行，没有 done       |

- accepted 不表示业务成功，完成后还要检查消息和 errors。
- 多轮测试用 enqueue 发起，等问题出现，再 enqueue 回答；不要先等待首条 dispatch。
- 最后 await h.app.close()；测试记录不用于无限增长的长跑监控。
