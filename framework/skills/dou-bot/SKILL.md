---
name: dou-bot
description: '在用户自己的项目中使用 dou-bot 开发 QQ 官方群聊和私聊机器人。用于创建多机器人应用、命令、附件处理、权限、按钮、对话、数据库服务和后台通知，以及测试与排错。'
---

# 用 dou-bot 开发 QQ 机器人

在用户的应用中实现需求，沿用已有业务结构、权限和命令习惯。

本技能面向**尚未发布的新版本**，支持 AppFactory、多账号和 PostgreSQL。已有项目先核对实际可用 API，不擅自升级用户依赖。

## 开始工作

1. 找到用户应用的 package.json、锁文件、编译配置与模块；技能目录不是业务目录。
2. 明确输入、回复和目标账号，优先复用已有 Controller、Service 和配置。
3. 业务从 `dou-bot` 导入，测试从 `dou-bot/testing` 导入；只使用已安装包的公开能力。
4. 运行应用自己的构建和测试。真实 QQ、数据库或外部服务联调按本次任务范围执行。

## 按需求读取

| 需求                           | 参考                                             |
| ------------------------------ | ------------------------------------------------ |
| 新建项目、模块、DI、启动和关闭 | [项目与服务](references/project.md)              |
| 命令、参数、normalize、帮助    | [命令与参数](references/commands.md)             |
| 权限、冷却、回复和按钮         | [权限与交互](references/runtime.md)              |
| 等待用户下一条输入             | [多轮对话](references/prompts.md)                |
| 图片、文件、自动上传和身份     | [附件与身份](references/attachments-identity.md) |
| prepare、state.set/provide/get | [上下文中间件](references/context.md)            |
| 多账号选路、外部 WS 和定时通知 | [多机器人](references/multi-bot.md)              |
| PostgreSQL、运行快照与性能排查 | [数据与运行](references/operations.md)           |
| 离线验证和 QQ 收发排错         | [测试](references/testing.md)                    |

按需读取；可复制模块和对应测试位于 assets，由各参考页链接。

## 实现要点

- 使用 TypeScript 5.9.3、ESM 和传统装饰器元数据；注入类保留值导入。
- Provider 在所有账号之间共享；当前 appId、用户、群和 Context 放在方法参数中。
- 回复用 return/ctx.reply；后台发送注入 MessageSender 或 BotManager。保存完整 BotTarget，不混用不同账号、场景下的 OpenID。
- PostgreSQL 必填，首次显式迁移；业务表和幂等由业务设计，不能把内存队列当作持久化任务。
- 外部 WS/定时器在 onApplicationReady 启动，在 onApplicationStopping 停止；尊重取消并等待异步工作。
- Slot.match/normalize 同步；异步查询放 Service 或 prepare/provide。
- 同条附图用 Images，下一条附件用 prompt 后筛选，直接上传用 OnAttachment；下载和处理由业务实现。
- 处理器结束后不复用 ctx；不要将 QQClient/QQApi 当成共享注入令牌。

## 交付

简要说明使用指令、运行方式和实际验证结果。区分离线模拟、真实 SQL/接口测试和 QQ 客户端确认，不用历史验收或平台文档代替当前测试。
