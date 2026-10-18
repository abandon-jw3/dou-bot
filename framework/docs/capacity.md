# 容量配置与运行监测

- 本页启动和快照示例适用于当前未发布源码。
- 入站和出站预算由整个应用共享；去重、回复和 prompt 状态按账号隔离。
- 群数不能直接换算容量，应估算消息率、处理耗时及保留记录数量。

## 从调用量估算

以 2,000 个群、每群每天 50 次调用为例：

| 分布方式       | 平均调用量                    |
| -------------- | ----------------------------- |
| 每天总计       | 100,000 次                    |
| 分布到 24 小时 | 约 1.16 次/秒                 |
| 集中到 8 小时  | 约 3.47 次/秒、12,500 次/小时 |

- 另行估算活动高峰、按钮、附件、prompt 回答及被拒绝的调用。
- 注册原始消息 On 后，普通聊天也可能进入执行流程。
- 粗略吞吐为“并发数 ÷ 平均占用秒数”，需给网络和下游服务留余量。
- 增加并发不会加速同步 CPU 工作；prompt 等待用户时释放执行槽，但仍占用缓存。

## 显式配置一个部署起点

以下用于容量估算，**不是默认值，也不是 QQ 配额或吞吐保证**：

```ts
const app = await AppFactory.create(AppModule, {
  database, // 见数据库指南；先执行显式迁移
  bots: [{ appId, secret, transport: { type: 'ws' } }],
  execution: {
    concurrency: 32,
    queueCapacity: 2000,
    queueMaxBytes: 32 * 1024 * 1024,
    dedupMaxEntries: 50000,
    replyScopeMaxEntries: 200000,
  },
});
```

| 资源         | SDK 默认 | 上述配置 | 需要考虑                                       |
| ------------ | -------: | -------: | ---------------------------------------------- |
| 执行并发     |        8 |       32 | 业务、网络和回复等待时间                       |
| 排队容量     |    1,000 |    2,000 | 短时高峰与可接受等待时间                       |
| 事件字节预算 |   16 MiB |   32 MiB | 仅限制事件输入，不是进程内存上限               |
| 去重记录     |   10,000 |   50,000 | 完成后默认保留 10 分钟；满时可提前淘汰已完成项 |
| 回复序号记录 |   10,000 |  200,000 | 最后引用释放后保留 1 小时，不提前淘汰有效项    |

- 每小时 12,500 条消息可能先耗尽默认 10,000 条回复记录，仅提高并发无效。
- 持续 50 条新消息/秒，一小时约需 180,000 条回复记录，另需预留在途任务空间。
- prompt 默认最多 1000 个，冷却记录默认最多 10000 条，需按同时活跃的会话估算。
- 上下文中间件默认每次执行 64 个 Key；每个事件默认 32 次受管操作。
- 不随意缩短回复记录保留时间，避免后续回复重复使用 msg_seq。
- 队列吸收短时高峰，长时间排队可能超过 QQ 回复窗口。

## 读取容量与延迟

读取某个账号的业务统计；应用级队列另见 app.snapshot().inbound / outbound：

```ts
const snapshot = app.bots.get(appId).snapshot();
const { capacity, rejections, timing } = snapshot;
console.log({
  active: snapshot.queue.active,
  queued: snapshot.queue.pending,
  replyRecords: capacity.replyScopes.size,
  replyRecordLimit: capacity.replyScopes.limit,
  queueFull: rejections.queueFull,
  replyScopesFull: rejections.replyScopesFull,
  meanQueueWaitMs:
    timing.queueWait.count === 0 ? 0 : timing.queueWait.totalMs / timing.queueWait.count,
});
```

### 容量与拒绝原因

- capacity：并发、队列、字节上限，以及去重/回复记录的数量和上限。
- 快照是独立副本，修改它不会调整应用配置。
- rejections 为实例累计计数，各项之和等于 events.rejected；每个事件只记首个适用原因。

| 字段                | 原因                       | 优先检查                   |
| ------------------- | -------------------------- | -------------------------- |
| invalidEvent        | 事件非法或超过大小限制     | 输入格式、maxEventBytes    |
| queueFull           | 执行和排队名额已满         | 处理时长、下游等待         |
| bytesFull           | 保留事件字节预算不足       | 事件大小、queueMaxBytes    |
| acknowledgmentsFull | 自动按钮确认通道已满       | 按钮事件高峰               |
| replyScopesFull     | 回复序号记录不足           | 消息率、保留窗口、记录上限 |
| dedupFull           | 去重记录全部被活跃事件占用 | 在途任务、长对话           |

- 未匹配、重复事件、关闭状态不属于上述拒绝项。
- Guard 拒绝、冷却、输入错误、业务失败发生在接纳之后，需另看业务和错误记录。
- HTTP/WS 层已拒绝的原始请求不计入这里。
- WS 过载时断开并等待容量恢复，Webhook 返回 503；平台不保证无限期重投。

### 耗时

| timing 字段 | 含义                                                                       |
| ----------- | -------------------------------------------------------------------------- |
| queueWait   | 初次调度或 prompt 恢复时的排队耗时                                         |
| processing  | 已结束事件占用执行槽的累计时间，含 I/O、回复和收尾，不含排队及 prompt 挂起 |

- 均包含 count、totalMs、maxMs，单位毫秒；queueWait.count 不一定等于事件数。
- 尚未结束的事件不计入 processing；prompt 回答不单独计一次 processing。
- 最近一分钟平均值用两次 count/totalMs 的差计算，累计 maxMs 不是该分钟最大值。
- 关闭后累计统计仍可读，当前缓存数量归零；不提供 P95/P99 或逐条消息历史。

## 验证自己的负载

在源码仓库的 framework 目录执行：

```sh
# 两小时虚拟时间，不是两小时真实运行
npm run benchmark:capacity -- virtual 7200000 virtual

# 可选：真实计时 65 分钟
npm run benchmark:capacity -- realtime 3900000 realtime
```

- 报告：work/capacity-review/<label>.json。
- 模拟 2000 个群，常态 20 次/秒，周期高峰 50 次/秒，包含慢请求、重复投递和发送失败。
- 检查延迟、拒绝、缓存、内存及关闭后的资源计数。
- 测试使用合成 HTTP 和内存数据库夹具，不连接 QQ 或 PostgreSQL；结果不能替代真实平台配额和自己的业务压测。
