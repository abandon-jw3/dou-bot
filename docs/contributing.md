# 源码开发与联调

npm 包名为 `dou-bot`，框架、业务示例与文档站统一维护于公开的 `dou-bot` 仓库。安装及业务用法见 [README](../README.md)。以下命令在框架源码根目录执行，不属于安装包中的消费者命令。

业务示例与文档站也在本仓库中，分别位于 `apps/example/`、`website/`。三工程安装、统一检查、Pages 部署及迁移说明见 [仓库维护指南](repository.md)；下文聚焦 SDK 本身。

## 开发检查

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
npm run example:offline
npm run example:query
npm run example:business
```

`check` 执行类型、两个公开入口的导出及双向类型契约、ESLint、格式、文档链接、构建、自动测试及历史消费者对当前安装包的兼容检查。`npm run test:compat` 另从 registry 安装已发布的 0.6.0 验证历史消费者；先完成 build/check。`coverage` 生成映射回 TypeScript 的覆盖率。GitHub Actions 在 Windows 与 Linux 的 Node 24.0.0 最低版本及 `.nvmrc` 开发版本上运行这两项检查；源码支持范围为 Node 24.x，TypeScript 固定为 5.9.3。

离线示例不读取凭证或连接 QQ。`query` 展示无序 Slot、Rest、Option 与帮助；`business` 组合自定义 City 装饰器、可注入权限服务、Guard、冷却、Markdown 和按钮。天气等数据是本地合成示例。源码示例允许相对导入 `src`；复制到独立应用时改用 `dou-bot` 和 `dou-bot/testing`。

## 真实 QQ 联调

复制 `.env.example` 为 `.env`，填写自己的测试机器人凭证；`.env` 不进入 Git 或 npm 包。同一机器人正在运行的其他 WS 客户端应先关闭。

| 命令                          | 用途                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `npm run diagnose:auth`       | 检查凭证和网关                                                                |
| `npm run diagnose:ws`         | 建立 WS，等待 READY 后关闭，无业务处理器                                      |
| `npm run example:qq`          | 常驻，响应 `/hello`                                                           |
| `npm run example:business:qq` | 常驻，运行完整演示业务；可通过 QQ_TRANSPORT 配置 Webhook                      |
| `npm run probe:live`          | 随机口令、最长 10 分钟的群聊/私聊交互探针；`-- --group-only` 仅群聊           |
| `npm run probe:media`         | 图片、原始 Markdown、回调按钮；`-- --buttons-only --no-prefix` 验证空前缀按钮 |
| `npm run probe:reconnect`     | 主动断开本探针的 WS，检查 RESUME 和心跳，不发送消息                           |
| `npm run probe:controls`      | 随机命令验证 Guard、参数、冷却、按钮允许/拒绝与 manual 确认                   |

探针逐个运行，按实际联调范围启用。controls 探针最多运行 10 分钟，首次拒绝测试仅在内存绑定每种场景的一个用户及会话，只记录场景、阶段、结果与错误分类。日志保存在忽略的 `work/` 中；每次运行采用独立产物目录，测试重编译不会删除正在运行的例子。

## 性能与持续运行

`npm run benchmark` 离线测量冷导入、合成指令吞吐与采样 RSS，输出 `work/benchmark-latest.json`。`npm run soak -- 180000` 进行三分钟持续运行，混合消息、按钮、重复投递、过载、接口故障以及 Guard/参数/冷却/prompt 组合，输出 `work/soak-latest.json` 和每次独立的 JSON 记录。时长允许 30 秒～72 小时，采样最多保留 240 个点；CI 在 Windows/Linux 跑 30 秒。它们使用模拟网络，不读取 QQ 凭证。

本轮当前源码新增三分钟组合验证；旧 0.1.x 数据仍作为历史基线保留。具体覆盖、报告字段和长跑命令见 [1.0 审查与测试说明](api-review-1.0.md)。具体证据见 [验证记录](validation-report.md) 和 [实现审计](implementation-audit.md)。

## 设计与发行

- [开发方案](development-plan.md)、[公开设计契约](public-api.d.ts)、[审查记录](review-report.md)、[技术选型](technology-selection.md)。设计契约不是运行时入口，消费者使用随包生成的类型声明。
- [发布准备与流程](npm-release.md)。本仓库 CI 只验证，不自动发布 npm。
- [使用技能](../skills/dou-bot/SKILL.md)。两个技能示例会在独立包消费者中编译及运行，技能调用名为 `$dou-bot`。
