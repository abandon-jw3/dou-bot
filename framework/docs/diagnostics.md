# 阶段性能观测

> 当前未发布源码 API。默认关闭，不影响既有容量快照。

## 开启指标

```ts
const app = await AppFactory.create(AppModule, {
  database,
  bots,
  diagnostics: { enabled: true },
});
await app.start();

console.table(
  app.diagnostics.snapshot().metrics.map((m) => ({
    stage: m.stage,
    handler: m.handler,
    count: m.count,
    active: m.active,
    oldestActiveMs: m.oldestActiveMs,
    p95UpperMs: m.p95UpperMs,
  })),
);
```

- `app.diagnostics` 与普通 `snapshot()` 分开读取，避免容量采样自动复制全部阶段指标。
- 记录从应用创建开始的累计次数、总耗时、最大值、结果计数和固定耗时分桶。
- `active` 与 `oldestActiveMs` 显示尚未结束的阶段；不要只看已完成请求。
- 分位数是桶的近似上界；没有样本或落在超过 60 秒的溢出桶时为 `null`。
- 所有结果共同参与该指标的耗时分布；`outcomes` 单独统计成功、错误、超时、取消、拒绝、忽略、重复和缓存命中。
- 近期窗口需要对 `count`、`totalMs`、`buckets` 求差后计算，不能直接相减两个 P95。

## 先看哪些阶段

| 阶段                                         | 用途                                                          |
| -------------------------------------------- | ------------------------------------------------------------- |
| `webhook.body`、`webhook.parse`、`ws.parse`  | 接收正文和解析                                                |
| `webhook.verify`                             | 提交验签到原生回调，包括线程池与回调调度等待                  |
| `webhook.verify.wait`                        | 框架等待验签的时间，可能因超时或断线提前结束                  |
| `event.admission`、`event.normalize`         | 归一化、去重和接纳决策                                        |
| `event.queue`、`event.run`                   | 入站排队及占用执行名额的时间                                  |
| `handler.middleware`、`handler.guard`        | 各中间件与 Guard；`component` 为最终执行顺序下标              |
| `handler.bind`、`handler.context`            | 参数绑定与上下文参数读取                                      |
| `context.load`、`context.lookup`             | 实际加载和缓存查询；命中未完成 Promise 也算缓存命中           |
| `handler.invoke`、`handler.total`            | 回调本身，以及包含绑定、权限和自动回复的整个处理过程          |
| `reply.wait`                                 | 同一消息的回复串行等待，发生在出站排队之前                    |
| `outbound.queue`、`outbound.run`             | 出站排队和发送任务占用                                        |
| `control.queue`、`control.run`               | 独立的按钮确认通道                                            |
| `qq.token.wait`、`qq.token.refresh`          | Token 等待及实际刷新                                          |
| `qq.http.headers`、`qq.http.body`、`qq.http` | 等待响应头、读取正文及请求整体；`operation` 区分固定 API 类别 |
| `route.learn`、`route.lookup`                | 框架群地址存储的整体操作；尚未细分连接池与 SQL                |
| `prompt.wait`                                | 挂起到恢复调度之间的时间，不包含重新排队                      |
| `event.drain`、`cache.prune`                 | 收尾与实际到期清理                                            |

- 耗时使用单调时钟，单位为毫秒，**不等于 CPU 时间**。
- 父子阶段会嵌套，并行操作会重叠，不能简单相加。
- `event.run` 排除 prompt 挂起；`handler.invoke` 和 `event.total` 包含这段等待。
- 原生验签可能在 HTTP 等待结束后继续占用资源，因此两个验签指标会不同。
- 框架自动覆盖自身调用。业务自行发起的 `fetch`、渲染和任意 SQL，首版只体现在所在回调的总耗时中。

## 采样执行链

```ts
diagnostics: {
  enabled: true,
  traceSampleRate: 0.01,
  onSpans(spans, signal) {
    signal.throwIfAborted();
    // 将这一批结构化记录交给自己的监控适配器。
    // 本例只统计数量，不发送网络请求。
    console.log('diagnostic spans:', spans.length);
  },
}
```

- 在入口事件或后台操作上决定是否采样，子阶段继承同一 `traceId`。
- `spanId`、`parentSpanId` 表示已知的执行范围；部分阶段是同一范围内的兄弟节点。
- prompt 等待和恢复后的处理保留原执行关联；回答消息有独立的入口记录。
- 共享 Token 刷新有独立关联，各消息的 Token 等待分别计时。
- 数据不包含正文、用户/群/QQ 消息 ID、完整 URL、SQL、密钥或异常文本。
- 只保留配置账号、注册处理器标识、中间件/Guard 下标和固定 API 类别。
- 跨账号发送继承原执行关联，HTTP 标记实际发送账号；路由尚未确定账号时不填写 `appId`。
- 不配置 `onSpans` 时，可调用 `app.diagnostics.takeSpans()` 取走缓冲记录。它与自动导出消费同一队列，通常选择一种方式。

## 边界与关闭

| 配置               |  默认值 |
| ------------------ | ------: |
| `enabled`          | `false` |
| `traceSampleRate`  |     `0` |
| `maxSeries`        |    2048 |
| `maxActiveSpans`   |    4096 |
| `maxPendingSpans`  |    2048 |
| `exportIntervalMs` |    1000 |
| `exportTimeoutMs`  |    1000 |

- 超过指标或在途观测上限，增加 `droppedMeasurements`；超过采样缓冲上限，丢弃新记录并增加 `droppedSpans`。
- 指标上限或缓冲上限导致的丢弃可能使执行链不完整；先检查丢弃计数再解释数据。
- 缓冲预算包含正在交给导出器的批次；忽略取消的导出器在实际结束前不会释放这部分预算。
- 导出在请求路径外批量执行，没有记录时不启动周期任务。导出器仍运行在同一进程，应避免同步阻塞工作。
- 一次导出失败、超时或非法返回值会停用本次应用的自动导出；观察 `exportFailures` 和 `exportDisabled`。它不调用业务 `onError`，也不改变业务返回值。
- 关闭会结束尚在观测的阶段并标为取消；在剩余关闭期限内尝试刷出缓冲。迟到完成不会重新计数。
- 已关闭的指标仍可读取；采样有丢弃或导出未合作时，关闭不承诺送达全部诊断记录。
- 关闭后会释放用户导出回调；单独保留读取器不会使整个应用继续存活。

## 离线演示

在源码仓库的 framework 目录执行：

```sh
npm run example:diagnostics
```

示例使用内存测试入口，不读取 `.env`，不连接 QQ 或 PostgreSQL。
