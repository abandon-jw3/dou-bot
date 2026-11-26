# 性能观测

用阶段耗时判断慢在框架排队、业务逻辑还是下游接口。默认关闭；在应用配置中开启：

```ts
diagnostics: { enabled: true, traceSampleRate: 0.01 }
```

## 读取指标

从 dou-bot 导入 Application 类型；app 为已创建的应用。

<<< @/../examples/monitoring.ts#stages

| 观察阶段                                        | 排查方向                       |
| ----------------------------------------------- | ------------------------------ |
| webhook.verify、ws.parse                        | 验签或入口解析                 |
| event.queue、outbound.queue                     | 入站或出站积压                 |
| handler.middleware、handler.guard、handler.bind | 准备数据、权限或参数绑定       |
| context.load、handler.invoke                    | 懒加载或业务处理               |
| qq.token.wait、qq.http.headers、qq.http.body    | Token、响应头或响应体等待      |
| route.learn、route.lookup、prompt.wait          | 群地址持久化、选路或等用户回答 |

- 指标是累计值；观察最近一段时间时，用两次计数和直方图的差。
- P95/P99 为直方图桶的近似上界；没有样本或落在溢出桶时为 null。
- 耗时包含异步等待，不等于 CPU；嵌套或并行阶段不能直接相加。
- `oldestActiveMs` 用于找未结束的慢操作。SQL 执行计划、渲染等业务内部耗时需自行补充观测。

## 采样与导出

```ts
diagnostics: {
  enabled: true,
  traceSampleRate: 0.01,
  async onSpans(spans, signal) {
    signal.throwIfAborted();
    // 在这里调用自己的监控适配器；传入 signal，并等待导出结束。
    console.log('本批采样条数', spans.length);
  },
}
```

- 不配置 onSpans 时，可用 `app.diagnostics.takeSpans()` 取走采样；两种方式通常选一种。
- 不记录正文、用户/群 ID、QQ 消息 ID、URL、SQL 或密钥。
- 导出失败、超时或返回值不合法会禁用本次应用的自动导出；检查 `exportFailures`、`exportDisabled`。
- 数据有上限；先检查 `droppedMeasurements`、`droppedSpans`，再解释不完整的执行链。
- 默认：2048 个指标系列、4096 个在途阶段、2048 条待导出采样，导出间隔/超时各 1000ms。
- 导出器运行在同一进程，避免同步阻塞；完整选项见 [类型索引](../api/types.md#root-DiagnosticsOptions)。
