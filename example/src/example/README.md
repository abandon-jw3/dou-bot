# 功能示例

- 适用于已安装的 **dou-bot 0.7.0**，AppModule 已注册此模块。
- 按 [项目说明](../../README.md) 启动，发送 `/example` 或 `/示例` 查看入口。
- 以下按默认 `/` 前缀编写；示例只展示交互，不保存上传文件或身份数据。

## 按功能查找代码

| 功能                       | 文件                                                                   |
| -------------------------- | ---------------------------------------------------------------------- |
| 模块与服务注入             | [模块](example.module.ts)、[服务](example.service.ts)                  |
| 文字参数、回复、按钮、冷却 | [命令控制器](example.controller.ts)                                    |
| 图片、分条附件、DOCX 上传  | [附件控制器](example-attachments.controller.ts)                        |
| 用户、群和角色             | [身份控制器](example-identity.controller.ts)                           |
| 场景、用户、角色限制       | [访问限制](example-access.controller.ts)                               |
| 自定义 Guard               | [Guard](example.guard.ts)、[私聊控制器](example-private.controller.ts) |
| 模块统一权限               | [模块 Guard](module-guards/module-guards.module.ts)                    |
| 多轮对话                   | [对话控制器](example-prompt.controller.ts)                             |
| 原始事件统计               | [事件观察器](example-events.controller.ts)                             |

## 命令与参数

| 输入                                            | 观察结果                                      |
| ----------------------------------------------- | --------------------------------------------- |
| `/example` 或 `/示例`                           | 所有示例的入口列表                            |
| `/example-arg 小明`                             | 使用默认次数，回复一次问候                    |
| `/example-arg 小明 2`                           | 将第二个位置参数转换为整数，回复两行问候      |
| `/example-arg 小明 0`                           | 不满足 1～3 的范围，收到参数和用法提示        |
| `/example-args 小明 "两个 单词" --flag`         | 查看三个分词；带空格的引号内容是一个元素      |
| `/example-option --name 小明 --times 2 --shout` | 长选项和布尔开关                              |
| `/example-option -n 小明 -t 2 --shout=false`    | 短选项与显式 false                            |
| `/example-slot 明天 散步 北京 带伞 --detail`    | 城市=北京，活动=散步，剩余=明天 / 带伞        |
| `/example-slot 明天 北京 散步 带伞 --detail`    | 交换城市与活动的位置，解析结果相同            |
| `/example-slot 上海 骑行`                       | 没有剩余参数，Rest 为 `[]`                    |
| `/example-context`                              | 通过 `ctx.reply()` 手动回复当前会话           |
| `/example-group`                                | 方法级 Guard：群聊放行，私聊提示拒绝          |
| `/example-private`                              | 类级 Guard：私聊放行，群聊提示拒绝            |
| `/example-cooldown`，随后立即发送 `/示例冷却`   | 同会话同用户共享 3 秒冷却；别名不能绕过       |
| `/example-button`                               | 发送带“确认示例”按钮的 Markdown，点击进入回调 |
| `/example-events`                               | 查看消息事件计数，包含当前这条消息，重启归零  |
| `/help example-slot`                            | 查看根据装饰器声明生成的帮助                  |

- Slot 示例识别北京、上海、广州和散步、骑行，只回显解析结果。
- Args 保留完整分词；Rest 收集剩余普通词，不掩盖缺参、重复或未知选项。
- 输入错误会回复用法；完整帮助用 `/help example-slot`。

## 图片、文件与身份

| 操作                                          | 结果                                            |
| --------------------------------------------- | ----------------------------------------------- |
| `/example-images 备注` 与 1～4 张图片同条发送 | 回复图片数量与备注                              |
| `/example-attachments` 附带附件               | 查看附件数量                                    |
| `/example-upload video` / audio / file        | 提问后接收下一条附件                            |
| 直接上传“报告_20261007.docx”                  | 自动匹配文件名，确认接收；同会话用户有 3 秒冷却 |
| `/example-identity`                           | 查看当前用户、群和角色                          |
| `/example-identity-button` 后点击             | 查看本次点击者身份                              |

- 追问可发送“取消”；类型或数量错误时提示并结束，不自动重问。
- 文件事件需由 QQ 实际投递；文件名匹配不代表 DOCX 内容有效。
- 下载、内容校验和解析接入自己的服务。
- 角色缺失显示未知，按钮不推断角色。

## 内置权限示例

| 输入                      | 行为                                                |
| ------------------------- | --------------------------------------------------- |
| `/example-group-only`     | 群聊放行，私聊拒绝                                  |
| `/example-private-only`   | 私聊放行，群聊拒绝                                  |
| `/example-users`          | 仅指定私聊 OpenID；请先替换源码中的占位 ID          |
| `/example-owner`          | 仅当前群主                                          |
| `/example-managers`       | 当前群主或管理员；缺失角色时拒绝                    |
| `/example-manager-button` | 群主/管理员可以发送，按钮配置 QQ 原生管理者点击权限 |

- UsersOnly 填 OpenID，不是 QQ 号；动态名单使用自定义 Guard。
- 角色装饰器支持命令和附件处理器，不能施加到按钮回调。
- 管理者按钮设置 permission: managers，仅发往群聊；命令自身仍需权限检查。
- 连接自己的机器人后，用群主、管理员、成员分别检查允许和拒绝路径。

## 模块、类和方法级 Guard

| 命令                       | 规则                             |
| -------------------------- | -------------------------------- |
| `/example-module-info`     | 模块级：当前群内成员可用         |
| `/example-module-settings` | 模块级 + 类级：当前群主或管理员  |
| `/example-module-owner`    | 模块级 + 类级 + 方法级：当前群主 |

- 顺序为模块配置 → 模块类 → 控制器类 → 方法，规则累加且不去重。
- 模块规则只作用于直接注册的控制器，不传播到其他模块。
- Guard 必须注册或通过模块导出引入，详见 [Guard 指南](https://abandon-jw3.github.io/dou-bot/guide/guards.html)。

## 二次输入与多轮会话

| 命令                      | 使用方式                                                             |
| ------------------------- | -------------------------------------------------------------------- |
| `/example-prompt`         | 按提示输入角色名，再输入服务器；每轮默认等待 60 秒，可发送“取消”退出 |
| `/example-prompt-image`   | 按提示发送一张图片，展示附件信息                                     |
| `/example-prompt-timeout` | 5 秒内输入文字，或发送“取消”/cancel；示例会明确回复超时/取消结果     |

- 每次 prompt 都要 await；结果分 received、timeout、cancelled。
- 新一轮用收到的 message.prompt/reply，引用最新输入。
- 只接收同群同用户或同一私聊的回答，回答不会再触发命令或观察器。
- 群聊必要时 @机器人回复；敏感操作需复核新输入的权限。

## 回复与测试

- 命令返回字符串自动回复；手动 reply/prompt 后返回 void。
- OnButton 返回 void，使用 ctx.send；默认自动 ACK，手动模式需 ctx.ack。
- 原始 On 只统计事件，不受模块 Guard 保护，也不自动回复普通聊天。
- 在 example 项目目录运行 `npm test` 或 `npm run check`。
- 对话测试先 enqueue 命令，再按问题记录投递回答，最后等待 done；见 [测试代码](../../tests/prompt.test.ts)。
- 停用示例时，从根模块移除 ExampleModule 的导入和 imports 项。
