# 分布式并发对照

- 发压端运行在本机；服务器运行 SDK 和模拟 API，API 的固定延迟保持在服务器环回网络中。
- 输入和控制消息通过 SSH；测试端口只绑定 127.0.0.1，不修改 Nginx，也不连接 QQ 或真实数据库。
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
- 单轮计划首次事件不能超过 200,000，以保持本轮回复记录预算不变。长时间高吞吐需要另测缓存与内存。
- 阶段观测使用 `--diagnostics off|metrics|sampled`，默认 `off`；`sampled` 固定采样 1%。在相同并发、负载和资源预算下比较三档，单独报告观测开销。
- 观测测试显式设置 `maxActiveSpans: 8192`，覆盖 2,000 条排队事件及并行处理；导出器只计数并保留最多 80 条示例，不包含外部监控系统的网络成本。
- 阶段汇总及导出计数写入 SDK 最终报告；不会逐条打印日志或把大型诊断数据放入实时控制帧。

## 读懂结果

- 本机报告在 `work/distributed/<label>/report.json`，包含两端指纹、配置、各阶段统计及三份子进程报告。
- `integrity` 检查漏发、异常、引用来源、完成通知及资源释放；它不等于容量达标。
- `capacityPassed` 要求该阶段全部接纳、没有非预期业务终态，且末尾最多 30 个采样点的排队中位数为 0。还应结合原始队列曲线、P95/P99 和 CPU 判断。
- 成功业务吞吐排除了预设的权限拒绝、参数错误和业务异常；这些终态单独计数。
- 端到端耗时由发压端的同一个单调时钟计算，包含 SSH 输入及完成通知返回；服务器另记接纳后的耗时。
- 跨机时钟偏移只用于阶段对齐，报告保留校准往返与不确定范围，不用于相减计算请求耗时。
- 每轮自动关闭自己的进程、转发和临时单元；报告保留且拒绝覆盖。网络、SQL、渲染和平台配额仍需按实际部署单独验证。
