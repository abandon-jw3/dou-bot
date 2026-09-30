---
name: dd-bot
description: '使用 dou-bot SDK 开发、修改和测试 QQ 官方机器人业务。适用于 dou-bot 模块与依赖注入、命令装饰器、Slot/Rest/Option、Guard/冷却、消息按钮和 WS/Webhook 接入；不用于无关的 NestJS、Koishi 或其他平台机器人项目。'
---

# 使用 dou-bot 开发机器人

以用户当前业务项目为工作对象，通过 SDK 的公开 API 完成功能和对应验证。本技能按 dou-bot **0.6.0 / 契约 1.7** 核对；项目实际安装的版本、类型声明和用户要求优先，不为套用示例而降级依赖或修改框架内核。

技能调用名和目录保留为 `$dd-bot`；npm 包、代码导入和安装目录使用 `dou-bot`。

## 先确认项目边界

- 检查目标项目的 package.json、锁文件、tsconfig、启动和测试脚本，确认 dou-bot 的来源与版本。普通业务使用 `dou-bot`，离线测试使用 `dou-bot/testing`；业务代码不导入框架内部路径或本机另一份源码。
- 基线为 Node.js 24+、TypeScript 5.9.3、ESM 和传统参数装饰器。构造注入依赖运行时元数据，不能只凭 TypeScript 类型推断启动成功。
- SDK 当前仅面向 QQ 官方群聊和私聊，每个应用选择 WS 或 Webhook。保留用户选定的业务、前缀、权限及部署方式；天气、城市词典、白名单和空前缀都是示例选择，不是框架要求。
- dou-bot@0.6.0 已以 MIT 发布到官方 npm registry，公开下载与独立消费者已验证。npm 上的 dd-bot 是其他项目。先核对项目当前依赖；新项目可使用 `npm install --save-exact dou-bot@0.6.0`，不要把发布标签当作固定版本。

需要更新知识时，优先读取已安装 SDK 的导出声明，以及可访问的框架源码/文档。维护参考为 [框架仓库](https://github.com/abandon-jw3/dou-bot) 和 [独立业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/apps/example)，现统一维护于公开的 `dou-bot` 仓库；新用户可使用 [公开文档与示例](https://abandon-jw3.github.io/dou-bot/)。联网查阅不是执行本技能的硬性前提。

## 按任务读取参考

| 当前任务                                                 | 读取内容                                |
| -------------------------------------------------------- | --------------------------------------- |
| 新建消费者、模块、Provider、构造注入、启动关闭           | [工程与 DI](references/project.md)      |
| 命令、无序参数、自定义 City 装饰器、剩余参数、选项和帮助 | [命令参数](references/commands.md)      |
| 权限检查、冷却、文本/图片/Markdown、按钮和上下文         | [执行控制与消息](references/runtime.md) |
| 二次输入、超时取消、多轮回复与会话测试                   | [二次输入](references/prompts.md)       |
| 离线测试、故障定位、真实 QQ 验收                         | [测试与联调](references/testing.md)     |

按需读取对应参考，不必每次加载所有文件。需要一个可编译的起点时，可复制 [minimal-module.ts](assets/minimal-module.ts) 和 [minimal-module.test.ts](assets/minimal-module.test.ts) 到同一个业务目录，再适配业务服务、策略和相对导入。它们只演示解析、DI 和控制流程，不提供真实天气数据，也不启动真实 QQ 连接。

## 实现中保持这些约束

- 每个处理器参数明确标注来源；构造注入的类使用值导入，接口或配置使用显式 `@Inject(token)`。
- Slot 匹配保持同步且无副作用；异步业务查询放进 Service。Rest 收集未消费参数，不能吞掉 Slot 歧义、重复值或非法选项。
- 权限使用 Guard；它先于参数绑定和冷却。Provider/Guard 是单例，每次调用的数据保留在局部变量或明确的请求参数中。
- 命令返回消息可自动回复；调用 `ctx.reply()` 后返回 void。按钮收到确认与业务回复是两件事，不把 interactionId 用作消息引用。
- 测试和联调区分证据：离线断言、第三方数据接口请求、QQ 接收/发送、客户端显示分别记录。用户要求真实业务时，不用模拟数据掩盖接口失败。

## 结束本次工作

优先运行目标项目已有的相关类型检查、构建与测试，按改动范围选择验证。新增示例应使用真实 tsc 装饰器产物执行一次；SDK 安装与导出问题应在独立消费者中验证。

报告实际完成的业务、调用方式、通过的验证和仍待输入的条件。只有任务已包含真实 QQ 联调、发布或仓库操作时才进行对应外部动作；沿用当前会话中明确的授权范围。本技能和参考中的示例本身不授予额外操作权限。
