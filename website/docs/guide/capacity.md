# 容量与运行监测

用 `app.snapshot()` 观察运行状态和负载。**capacity、rejections、timing 从 0.8.0 起提供。**

## 关注哪些数据

| 字段                   | 用途                                                   |
| ---------------------- | ------------------------------------------------------ |
| queue.active / pending | 正在处理和等待的事件数                                 |
| prompts.pending        | 等待用户回答的对话数                                   |
| capacity               | 并发、字节、去重和回复记录的用量及上限                 |
| rejections             | 按原因分类的累计接纳拒绝                               |
| timing.queueWait       | 排队耗时，包含 prompt 恢复调度                         |
| timing.processing      | 已结束事件占用执行槽的时间，含 I/O，不含排队和对话挂起 |

在应用的监测逻辑中读取：

```ts
const snapshot = app.snapshot();
const wait = snapshot.timing.queueWait;
console.log({
  active: snapshot.queue.active,
  queued: snapshot.queue.pending,
  replyRecords: snapshot.capacity.replyScopes.size,
  replyLimit: snapshot.capacity.replyScopes.limit,
  meanQueueWaitMs: wait.count === 0 ? 0 : wait.totalMs / wait.count,
  rejections: snapshot.rejections,
});
```

- 快照为副本，修改它不会调整运行配置。
- timing 包含 count、totalMs、maxMs，单位毫秒；尚未结束的事件不计入 processing。
- 最近一分钟平均值用两次 count / totalMs 的差计算；累计最大值不是该分钟最大值。
- 不提供 P95/P99，百分位需在自己的监测中采样。

## 拒绝原因

| 字段                | 优先检查                       |
| ------------------- | ------------------------------ |
| invalidEvent        | 输入结构和单事件大小           |
| queueFull           | 处理耗时、下游等待、排队量     |
| bytesFull           | 事件大小和保留字节预算         |
| acknowledgmentsFull | 按钮确认的并发高峰             |
| replyScopesFull     | 消息率、一小时回复记录保留窗口 |
| dedupFull           | 在途任务和长对话占用           |

- 每个事件只计首个适用原因，总和为 events.rejected。
- Guard、冷却和业务失败属于接纳后的结果，需另看业务日志与 onError。

## 调整容量

- 群数不等于吞吐，先估算调用频率、处理耗时和高峰。
- execution 默认并发 8、排队 1000；更多并发不会加速同步 CPU 工作。
- 去重、回复记录默认各 10000 条；回复记录默认保留一小时，可能先于队列达到上限。
- prompt 等待时释放并发名额，但仍占会话、事件和缓存资源。
- 不随意缩短有效回复记录保留时间，避免复用已发送的回复序号。
- 默认值与容量关系见 [配置](./configuration.md#执行与容量)。
