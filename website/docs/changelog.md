# 更新日志

## 0.7.0 · 2026-10-07

新增图片与附件参数、自动附件处理器和身份参数，文档与示例已使用精确依赖 0.7.0。

- Attachments / Images 支持同条消息的附件选择和数量校验；selectAttachments 用于 prompt 接收后的分条附件。
- OnAttachment 可以按文件名、扩展名和分类接收直接上传的文件，支持 Guard、冷却和追问。
- User、UserId、Group、GroupId、Role 提供当前发送者或按钮操作者的身份快照。
- 附件增加 voiceWavUrl / asrReferText；测试入口显式导出 TestAdmission。

升级时使用 Node.js `>=24.0.0 <25`，开发与部署推荐 24.21.0；TypeScript 保持 5.9.3。自定义 Guard 的 kind 新增 attachment 分支，ErrorPhase 也增加 attachment；原来以 else 代表 button 的代码需要显式区分。早期源码的 Videos / Audios / Files 已改为 prompt + selectAttachments，它们没有在 0.6.0 发布过。

```sh
npm install --save-exact dou-bot@0.7.0
```

参见 [附件指南](./guide/attachments.md)、[身份指南](./guide/identity.md) 和 [npm 0.7.0](https://www.npmjs.com/package/dou-bot/v/0.7.0)。

## 文档更新 · 2026-10-06

示例现在按自己的业务项目提供文件位置、运行步骤和预期回复；补充了权限检查和 Webhook 连接检查。使用这些文档不需要升级 SDK，仍安装 0.6.0。

## 0.6.0 · 2026-09-30

dou-bot 0.6.0 已在 npm 发布，采用 MIT 许可证。本手册的 API 和示例适用于此版本。

- 提供静态模块、依赖注入、控制器与 20 个公开装饰器。
- 支持位置参数、Slot、Rest、Option、帮助、自定义前缀和空前缀。
- 提供模块/类/方法级 Guard、场景/用户/角色限制和命令冷却。
- 提供 prompt 多轮输入、超时和取消。
- 支持文本、图片、原始 Markdown、内联按钮和测试入口。
- 面向 QQ 官方群聊和私聊，提供 WS 与 Webhook 接入。

```sh
npm install --save-exact dou-bot@0.6.0
```

[npm 版本页面](https://www.npmjs.com/package/dou-bot/v/0.6.0)。安装标签可能变化，业务项目采用精确版本及锁文件。

## 使用前了解

- 消息投递和发送权限由你的 QQ 机器人账号决定；群角色缺失时，受角色限制的命令会拒绝。配置方法见 [访问限制](./guide/access.md)。
- 公网 Webhook 和多日连续运行尚未完成端到端验证。正式部署前，在自己的环境检查消息、按钮和重连行为，并观察持续运行状态；参见 [Webhook](./guide/webhook.md) 和 [部署指南](./guide/deployment.md)。
- prompt、冷却和去重状态保存在进程内，重启后会重置。需要持久化或跨实例处理的业务，应自行保存数据并保证幂等。
