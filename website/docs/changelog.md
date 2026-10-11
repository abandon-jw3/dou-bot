# 更新日志

## 0.7.0 · 2026-10-07

- `Attachments` / `Images`：读取同条消息附件并校验数量。
- `selectAttachments`：筛选 prompt 收到的分条附件。
- `OnAttachment`：按文件名、扩展名和分类处理直接上传。
- `User` / `UserId` / `Group` / `GroupId` / `Role`：读取当前身份。
- 语音附件增加 voiceWavUrl、asrReferText；测试入口导出 TestAdmission。

升级：

```sh
npm install --save-exact dou-bot@0.7.0
```

- 使用 Node.js `>=24.0.0 <25`，教程采用 24.21.0 和 TypeScript 5.9.3。
- 自定义 Guard 显式区分 command、button、attachment；不要用 else 默认代表 button。
- 错误阶段增加 attachment，穷尽判断需同步更新。
- 早期未发布源码的 Videos / Audios / Files 改用 prompt + selectAttachments。

用法见 [附件](./guide/attachments.md)、[身份参数](./guide/identity.md)。[npm 版本](https://www.npmjs.com/package/dou-bot/v/0.7.0)。

## 文档更新 · 2026-10-06

- 补充业务项目的文件位置、运行步骤和预期回复。
- 增加权限检查表及 Webhook 连接检查，当时适用版本为 0.6.0。

## 0.6.0 · 2026-09-30

- 模块、依赖注入、控制器和命令帮助。
- 位置参数、Slot、Rest、Option 与自定义前缀。
- 模块/类/方法 Guard、场景/用户/角色限制及冷却。
- prompt 多轮输入、超时和取消。
- 文字、图片、Markdown、内联按钮及离线测试。
- QQ 官方群聊/私聊，WS 与 Webhook 接入，MIT 许可。

[npm 版本](https://www.npmjs.com/package/dou-bot/v/0.6.0)。

## 使用前了解

- 消息和按钮权限取决于 QQ 账号；角色缺失时拒绝受角色限制的操作。
- 公网 Webhook 和多日连续运行尚未完成端到端验证，部署前需在自己的环境确认。
- 对话、冷却和去重不跨重启保留；持久化和幂等由业务负责。
