# 源码开发与联调

npm 包名为 `dou-bot`，框架与文档站统一维护于公开的 `dou-bot` 仓库。安装及业务用法见 [README](../README.md)。以下命令在仓库的 `framework` 目录执行，不属于安装包中的消费者命令。

文档站位于 `website/`。双工程安装、统一检查与 Pages 部署说明见 [仓库维护指南](repository.md)；下文聚焦 SDK 本身。

## 开发检查

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
npm run example:offline
npm run example:query
npm run example:business
npm run example:attachments
npm run example:identity
```

`check` 执行类型检查、两个公开入口的导出及双向类型契约校验、ESLint、格式检查、文档链接检查、构建、自动测试及当前源码 tarball 的独立消费者检查。`coverage` 生成映射回 TypeScript 的覆盖率。GitHub Actions 在 Windows 与 Linux 的 Node 24.0.0 最低版本及 `.nvmrc` 开发版本上运行这两项检查；源码支持范围为 Node 24.x，TypeScript 固定为 5.9.3。

离线示例不读取凭证或连接 QQ。`query` 展示无序 Slot、Rest、Option 与帮助；`business` 组合自定义 City 装饰器、可注入权限服务、Guard、冷却、Markdown 和按钮；`attachments` 演示同条附件装饰器、`prompt` 后调用 `selectAttachments` 的分条输入以及 `OnAttachment` 的直接文件上传；`identity` 演示命令和按钮的五种身份参数装饰器。源码示例允许相对导入 `src`；复制到独立应用时改用 `dou-bot` 和 `dou-bot/testing`。

## 真实 QQ 联调

复制 `.env.example` 为 `.env`，填写自己的测试机器人凭证；`.env` 不进入 Git 或 npm 包。同一机器人正在运行的其他 WS 客户端应先关闭。

| 命令                          | 用途                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `npm run diagnose:auth`       | 检查凭证和网关                                                                |
| `npm run diagnose:ws`         | 建立 WS，等待 READY 后关闭，无业务处理器                                      |
| `npm run example:qq`          | 常驻，响应 `/hello`                                                           |
| `npm run example:business:qq` | 常驻，运行完整演示业务；可通过 `QQ_TRANSPORT` 配置 Webhook                    |
| `npm run probe:live`          | 随机口令、最长 10 分钟的群聊/私聊交互探针；`-- --group-only` 仅群聊           |
| `npm run probe:multi-bot`     | 双机器人 WS 联调探针；详见 [双机器人验收](live-multi-bot.md)                  |
| `npm run probe:media`         | 图片、原始 Markdown、回调按钮；`-- --buttons-only --no-prefix` 验证空前缀按钮 |
| `npm run probe:reconnect`     | 主动断开本探针的 WS，检查 RESUME 和心跳，不发送消息                           |
| `npm run probe:controls`      | 随机命令验证 Guard、参数、冷却、按钮允许/拒绝与 manual 确认                   |
| `npm run probe:attachments`   | 用当前源码验证图文同条和视频/音频/文件分条输入，读取 `framework/.env`         |

探针日志保存在被 Git 忽略的 `work/` 中；每次运行采用独立产物目录，测试重编译不会删除正在运行的例子。

## 性能与持续运行

- `npm run benchmark`：离线测量冷导入、合成指令吞吐与采样 RSS，输出 `work/benchmark-latest.json`。
- `npm run soak -- 180000`：运行组合持续负载（时长范围 30 秒～72 小时，CI 跑 30 秒），使用模拟网络，不读取 QQ 凭证。
- `npm run benchmark:capacity -- virtual 7200000 local`：两小时虚拟时间容量与缓存到期回归。
- `npm run benchmark:distributed`：分布式并发对照工具，详见 [分布式并发对照](benchmark-distributed.md)。

## 契约与发行

- 公开类型契约：[public-api.d.ts](public-api.d.ts) 与 [testing-api.d.ts](testing-api.d.ts)。设计契约不是运行时入口，消费者使用随包生成的类型声明。
- 发布流程：[npm-release.md](npm-release.md)。本仓库 CI 只验证，不自动发布 npm。
- 配套技能：[skills/dou-bot/SKILL.md](../skills/dou-bot/SKILL.md)。
