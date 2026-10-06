# 附件和身份（0.7.0）

先确认项目安装 dou-bot@0.7.0，所有装饰器和类型从 dou-bot 根入口导入。按用户的实际操作选择入口：

- 指令与图片同条发送：Images 注入 readonly Attachment[]；Attachments 选择全部顶层附件。支持 name、description、minCount、maxCount，默认 minCount=0，无最大数量限制；数量校验在 Guard 之后、冷却之前。
- 指令后单独发送视频、音频、文件：await ctx.prompt，检查 received，再 selectAttachments(message.attachments, { kind, minCount, maxCount })。使用回答消息的 reply 引用附件。invalid 是正常业务输入，不抛异常、不自动回复；非法选项才是 HANDLER_CONTRACT。按需求明确重问或结束，不暗中添加重试和累计。
- 直接上传固定格式文件：OnAttachment({ filename: /^报告_\d{8}\.docx$/iu, extension: 'docx' })。filename 可精确字符串或 RegExp，extension 为单扩展名，kind 为 all/image/video/audio/file，条件在同一附件上取交集。不写筛选条件时接收所有带附件的消息，纯文字不触发。

分类使用去空白、忽略大小写并去除参数的 MIME；audio 也匹配 QQ voice，file 也匹配 QQ file 和其他合法 MIME。不从文件名猜测 MIME，不从 URL 猜测文件名，不读取引用或嵌套附件，也不将 ASR 变成命令。

OnAttachment 的 Attachments 参数是本处理器匹配的集合，Images 再从中筛选图片；ctx.attachments 是完整消息集合。支持 Ctx、两种附件及五种身份参数，不能使用文字参数。匹配处理器按现有发现顺序独立执行，Guard 拒绝、冷却或失败不停止其他处理器；await prompt 会延后下一处理器。pending prompt 和已识别命令优先，不能把自动附件路由当作命令失败后的兜底。

OnAttachment.invalidInput 默认为 report，可设 reply 对数量错误额外回复；commands.invalidInput 不控制它。处理器结束后旧 Context 失效，必须 await prompt；资源预算和回复序号按整条消息共享。下载、存储、DOCX 内容校验和解析由业务服务完成，元信息匹配不证明文件内容有效。可复制 [附件模块](../assets/attachments-module.ts) 和 [离线测试](../assets/attachments-module.test.ts) 起步。

身份参数用于 Command、OnButton、OnAttachment：User 注入冻结的 UserInfo（id，可选 username/bot/memberRole），UserId 为 string；Group 为仅含 id 的冻结 GroupInfo 或 undefined，GroupId 为 string 或 undefined；Role 为 member/admin/owner 或 undefined。只读当前事件，不查询或缓存资料；空昵称及 bot:false 保留。私聊没有群信息和角色，按钮不推断角色及其他资料。身份参数不做授权，限制行为继续用 Guard。

从 0.6.0 升级自定义 Guard 时，显式处理 kind:attachment 和 matchedAttachments；不要把 command 之外都当作 button。ErrorPhase 也新增 attachment。原始 On 只支持 Ctx。早期源码的 Videos/Audios/Files 参数装饰器没有发布，应改用上述分条方案。
