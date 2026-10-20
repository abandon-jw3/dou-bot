# 分布式并发对照

- 发压端运行在本机；服务器运行 SDK 和模拟 API，API 的固定延迟保持在服务器环回网络中。
- 输入和控制消息通过 SSH；测试端口只绑定 127.0.0.1，不修改 Nginx，也不连接 QQ 或真实数据库。
- 支持 Webhook、WS，以及一个共享应用内的双账号。默认仍为单账号 Webhook。
- 适用于当前源码仓库。使用相同源码、Node 24 和锁定依赖，先在两端完成编译。

## 准备服务器

在服务器的 framework 目录执行：

```sh
npm ci
node node_modules/typescript/bin/tsc -p tsconfig.test.json --outDir work/distributed-build
```

- SSH 账号需要启动临时 systemd 单元和端口转发的权限。
- 传输源码时排除 .env、生成物及 macOS 的 `._*` 元数据。两端 SDK 和工具指纹不一致时会拒绝开始发压。
- 本轮服务器测试预算固定为 1.5 核、1 GiB、禁用 swap；包括 SDK、夹具与监督进程，sshd 开销另计。

## 运行对照

先在本机验证协议及清理：

```sh
npm run benchmark:distributed -- --local --smoke --label local-smoke-1
```

服务器对照示例：

```sh
npm run benchmark:distributed -- \
  --host root@your-server \
  --directory /opt/dou-bot/framework \
  --node /opt/node/bin/node \
  --label c500-i32-o8-r1 \
  --concurrency 32 --outbound-concurrency 8 \
  --rate 500 --duration-ms 120000
```

- 依次对照入站/出站并发 `32/8 → 32/16 → 64/16 → 64/32`，其他配置保持一致；每轮使用不同 label。
- 正式对照包含 10 秒 200/s 预热、指定速率的测量阶段、15 秒 200/s 恢复；每轮重新创建实例。
- 健康混合负载保留参数、权限、图片、DOCX、按钮和 prompt，不混入大消息或下游故障阶段。`--smoke` 单独覆盖这些故障场景。
- 发压端最多 128 条 HTTP 连接、2,048 个在途请求，达到上限会记为漏发，不能隐去。
- 发压端空闲连接在 2 秒后回收，活动请求仍保留 10 秒超时；连接错误照常记录，不自动重试。SDK 与服务器的连接超时不因此改变。
- 单轮计划首次事件不能超过 200,000，以保持本轮回复记录预算不变。长时间高吞吐需要另测缓存与内存。
- 首次事件上限不包含 prompt 续答；续答也占用回复记录。单账号应据完整消息计划估算记录量，并核对 `replyScopesFull`，避免把缓存容量拒绝当成 CPU 吞吐瓶颈。
- 阶段观测使用 `--diagnostics off|metrics|sampled`，默认 `off`；`sampled` 固定采样 1%。在相同并发、负载和资源预算下比较三档，单独报告观测开销。
- 观测测试显式设置 `maxActiveSpans: 8192`，覆盖 2,000 条排队事件及并行处理；导出器只计数并保留最多 80 条示例，不包含外部监控系统的网络成本。
- 阶段汇总及导出计数写入 SDK 最终报告；不会逐条打印日志或把大型诊断数据放入实时控制帧。
- 开启观测后，`sdk.diagnostics.timeline` 每约 5 秒保存累计快照，并在阶段变化及关闭时补采。最多 256 份，超限记录 `droppedSamples`；`collectionMs` 单独记录复制快照的耗时。
- `timeline.windows` 用相邻计数与直方图差分计算窗口吞吐和分位数；`activeAtEnd`、`oldestActiveMsAtEnd` 是窗口末端的在途状态。窗口按完成时刻统计，可能包含此前开始的操作。
- `crossesPhase: true` 的窗口跨越预热、负载、恢复或关闭边界，应单独分析。采样定时器受事件循环调度影响，计算速率使用实际间隔，不假定精确 5 秒；不对累计 P95 或最大值做减法。

## WS 与双账号

在上述命令后添加：

```sh
--transport ws --bots 2 --first-bot-percent 80
```

- `--transport webhook|ws` 选择真实 SDK 接收链路。WS 模拟网关位于发压端，经反向 SSH 转发连接；网关 CPU 不计入服务器配额。
- `--bots 1|2` 选择账号数。双账号共享应用、入站/出站并发和排队预算；去重、回复记录等账号内缓存仍遵循框架原规则。
- `--first-bot-percent 80` 将约 80% 的首次消息分配给 A，其余给 B；默认双账号约各 50%。同一 prompt 的回答和重复投递始终归属原账号。
- 两个账号使用不同的模拟群 OpenID，逐条验证上下文账号、回复地址与 API 请求账号，避免只看汇总吞吐而遗漏串号。
- 网关支持 HELLO、IDENTIFY、心跳和 RESUME。**断线期间不缓存消息，RESUME 不自动重放**；这是明确的夹具策略，不代表 QQ 的交付保证。
- 用 `--isolation` 单列故障测试：仅允许双 WS、非 smoke、测量至少 20 秒；在测量段 20% 处要求 A 重连，45% 处停止 A，65% 处恢复 A，B 持续接收。该轮不作为无故障容量样本。
- 先运行 `--local --transport ws --bots 2 --smoke` 检查协议和资源清理，再在目标服务器测试。冒烟包含故意过载与下游失败，完整性通过不意味着每个阶段容量通过。

## 读懂结果

- 本机报告在 `work/distributed/<label>/report.json`，包含两端指纹、配置、各阶段统计及三份子进程报告。
- `integrity` 检查漏发、异常、引用来源、完成通知及资源释放；它不等于容量达标。
- schema 2 分开记录 `scheduled`（首次计划）、`written`（WS 成功写入的唯一首次事件）、`received`（到达 SDK 接纳入口的唯一首次事件）、`accepted` 与 `completed`。写入 socket 不等于被接纳。
- `notReceived` 是计划数减去收到数；`wsUnavailableAttempts` 包括连接不可用时的首次、重复和续答尝试，不能直接与首次事件数相加。`admissionAttempts` 也按尝试计数。
- `byBot` 保留每个账号的计划、接收、接纳、完成、终态与成功延迟。故障轮的 `isolation.passed` 检查 B 无丢失和非预期终态、A 确实重连并重新启动；A 在停止期间的损失照实保留。
- 错误分类在内部错误上报入口同步计数，正常 `onError` 仍按框架原队列执行。`lateErrorCallbacks` 记录事件完成后才到达的回调，不将已释放的临时条目误判成未知业务失败。
- `capacityPassed` 要求该阶段全部接纳、没有非预期业务终态，且末尾最多 30 个采样点的排队中位数为 0。还应结合原始队列曲线、P95/P99 和 CPU 判断。
- 成功业务吞吐排除了预设的权限拒绝、参数错误和业务异常；这些终态单独计数。
- 端到端耗时由发压端的同一个单调时钟计算，包含 SSH 输入及完成通知返回；服务器另记接纳后的耗时。
- 跨机时钟偏移只用于阶段对齐，报告保留校准往返与不确定范围，不用于相减计算请求耗时。
- 每轮自动关闭自己的进程、转发和临时单元；报告保留且拒绝覆盖。网络、SQL、渲染和平台配额仍需按实际部署单独验证。
- 大型报告在发压结束后用独立压缩 SSH 连接取回，完成后才改为正式文件名；输入连接不启用压缩。取回或分析失败会先保存 `failure.json`，再执行清理。
