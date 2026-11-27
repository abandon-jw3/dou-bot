# 更新日志

## 1.1.0

面向大型多模块机器人应用的开发体验与架构精简升级：

- **按钮被动回复与模式路由**：`ButtonContext.reply()` 与 `@OnButton` 返回值支持基于 `event_id` 的被动回复；`@OnButton` 支持 `string | RegExp | readonly string[]`；`@Command` 支持 `string | readonly string[]`；新增 `@Route()` 注入当前命中的规范命令名或按钮 ID。
- **全局异常钩子**：`AppOptions.onHandlerError` 统一拦截命令、按钮和附件处理器异常，可按错误类型决定用户回复文案与是否上报。
- **参数绑定顺序优化**：`@Slot()` 先于 `@Arg()` 与 `@Rest()` 匹配，剩余位置参数可直接按 `@Arg(0)` 取值。
- **全局模块与应用级扩展**：新增 `@Module({ global: true })`、`AppOptions.providers` 与 `AppOptions.middlewares`，消除基础设施模块重复导入和静态配置单件。

## 1.0.0

首个正式版本，提供面向 QQ 官方群聊和私聊的轻量 TypeScript 机器人框架：

- **模块与依赖注入**：`@Module`、`@Controller`、`@Injectable`、`@Inject` 与应用生命周期钩子。
- **多机器人与双接入**：`AppFactory` 创建共享业务应用，支持单/多账号分别使用 WebSocket 或 Webhook，提供 `BotManager`、`MessageSender`、`GroupRoutes` 与共享 PostgreSQL 连接池及显式迁移 `migrateDatabase`。
- **命令与参数**：位置参数 `@Arg`、无序槽位 `@Slot`（支持同步 `normalize`）、长短选项 `@Option`、`@Rest`、完整分词 `@Args`、自定义前缀与自动帮助 `HelpModule`。默认忽略未声明消费的普通余参。
- **附件与身份**：`@Images` / `@Attachments` 同条附件校验、`selectAttachments` 分条筛选、`@OnAttachment` 自动路由；`@User`、`@UserId`、`@Group`、`@GroupId`、`@Role` 注入冻结身份快照。
- **权限、中间件与多轮对话**：模块/类/方法三级 Guard 与内置限制装饰器、调用冷却 `@Cooldown`、上下文中间件 `@UseMiddleware` / `@ContextValue`、`ctx.prompt()` 多轮输入。
- **消息与按钮**：文字、图片、原始 Markdown 与内联键盘按钮，支持 `keyboard(btns, 4)` / `keyboard(btns, [2, 3])` 自动分行布局。
- **可靠性与观测**：入站/出站有界并发与字节预算、异步 Webhook Ed25519 验签与挑战签名、优雅停机排空、`app.snapshot()` 容量快照与可选阶段性能观测 `app.diagnostics`。
- **离线测试**：`dou-bot/testing` 提供单账号与多账号离线测试夹具。

## 使用前了解

- 运行环境要求 Node.js `>=24.0.0 <25`（推荐 24.21.0）与 PostgreSQL。
- 消息和按钮权限取决于 QQ 账号配置；角色缺失时拒绝受角色限制的操作。
- 群地址持久化到 PostgreSQL；消息任务、对话、冷却和去重保存在内存中，不跨进程重启保留，关键业务需自行保证持久化与幂等。
