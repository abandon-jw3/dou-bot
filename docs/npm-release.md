# dou-bot 的 npm 发布记录与流程

状态：**dou-bot@0.6.0 已于 2026-09-30 13:47（Asia/Shanghai）公开发布到 npm**，许可证为 MIT，发布账号为 fine_wei。完整性、来源提交与验证记录见 [发布记录](npm-release-0.6.0.json)，包页面见 [npm](https://www.npmjs.com/package/dou-bot/v/0.6.0)。

## 0.7.0 发行候选

准备日期：2026-10-06（Asia/Shanghai）。根包与锁文件版本为 **0.7.0**，公开契约为 **1.11**，目标为官方 npm registry、public 访问与 **latest** 标签。此处记录候选准备，不表示版本已经上传。`next` 暂不随此次发行调整；业务使用精确版本。

候选来源、SHA-256 / SHA-512、实际 tarball 与验收结果见 [0.7.0 候选记录](npm-release-0.7.0-candidate.json)。以下 0.6.0 内容保留为历史证据。

### 面向使用者的变更

- 图片与指令同条发送时，可用 `@Images()` 或 `@Attachments()` 注入附件并校验数量。视频、音频和文件可以经 `ctx.prompt()` 分条接收，再用 `selectAttachments()` 同步筛选。
- 用户直接上传文件时，可用 `@OnAttachment()` 按文件名、正则、扩展名及分类选择附件。多个处理器独立授权和冷却、按顺序执行，支持追问；每个处理器有独立的 Context 生命周期。
- `@User()`、`@UserId()`、`@Group()`、`@GroupId()`、`@Role()` 为命令、按钮及附件处理器提供当前事件的冻结身份快照。缺失群信息或角色为 undefined，不额外请求资料。
- 附件增加 voiceWavUrl / asrReferText；它们仅保存消息元信息。`dou-bot/testing` 显式导出 TestAdmission 类型。
- TypeScript 保持 5.9.3，生产直接依赖保持 reflect-metadata / ws。SDK、示例、文档及技能统一采用 MIT。

下载、DOCX 内容验证、保存、转码和识别由业务服务负责。公网 QQ Webhook、真实 QQ 自动附件路由及多日运行仍未完成验收；本次依据离线测试、本地 WS/Webhook 对照及短时持续运行结果准备发行。

### 从 0.6.0 升级

1. 使用 Node.js `>=24.0.0 <25`；推荐开发与部署版本为 24.21.0。安装上界相比 0.6.0 的 `>=24` 收紧。
2. 自定义 Guard 中显式处理 `kind: 'attachment'`，可读取 `matchedAttachments`。不要把 command 之外全部当作 button；ErrorPhase 的穷尽判断也需补 attachment。
3. 新 API 通过 SDK 根入口导入；原命令文字参数顺序、按钮确认、群聊/私聊身份范围、已有 prompt 能力与两个公开包入口保持。
4. 仅使用过早期源码的应用需要移除 Videos / Audios / Files 参数装饰器，改为 prompt + selectAttachments。这三个装饰器没有在 npm 0.6.0 中发布过。

详细用法见 [参数与自动附件指南](command-parameters.md)。

### 准备完成后的上传步骤

- 上传已验收的同一份 tgz，不在上传时重新打包。先核对候选记录的 SHA-256 和 source.dirty；有新改动时重新验收。
- 将这次实现和发行配置整理为可追溯的源码提交；记录应如实保留候选生成时的提交和工作区状态。版本标签应指向包含 0.7.0 代码的提交，不指向旧基线。
- 明确执行 npm 发布时，使用自己的 npm 登录和账号验证。不要将 token 或验证码放进仓库或候选记录。

```sh
npm publish ./work/release/0.7.0/dou-bot-0.7.0.tgz --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org/
```

### 发布后同步清单

1. 核对 registry 的版本、latest、tarball URL 与 integrity，匿名下载并比较候选字节，执行独立消费者验证；保留 next 的实际值。
2. 将 apps/example 精确依赖和锁文件升级为 registry 的 0.7.0，更新 vendor/sdk.json；增加图片、分条附件、身份和自动 DOCX 上传演示，再执行业务示例检查。
3. 将 website 精确依赖和锁文件升级为 registry 的 0.7.0，更新版本说明、用户指南、可运行示例和 API 索引；执行内容、构建及桌面/手机浏览器检查。
4. 将 `$dou-bot` 技能更新至 0.7.0 / 契约 1.11，补齐新 API 用法，并用实际 registry 包验证技能示例。
5. 更新交接文档、发行状态和源码标签，核对相应提交的 CI 与文档部署。历史 0.6.0 消费者和旧验收记录继续保留。

## 已确定的发行内容

- 原开发名 dd-bot 在 npm 上属于其他项目；新包名为 dou-bot，代码导入为 `dou-bot`、`dou-bot/testing`。GitHub 框架仓库后续更名为 dou-bot，技能调用名现统一为 `$dou-bot`。
- TypeScript 5.9.3、Node.js 24+、ESM。生产直接依赖仍只有 reflect-metadata 和 ws，版本沿用锁定配置。
- 包内包含 dist 的 JavaScript、类型声明及源码映射，README、MIT LICENSE、NOTICE 和五份使用指南。源码映射包含框架源代码；不包含凭证、测试日志、开发脚本或设计草案。
- 保留 @satorijs/adapter-qq 的适用 MIT 声明。独立示例应用的 `package.json` 保留 `"private": true` 以禁止误发布到 npm；该字段不影响 GitHub 仓库可见性，框架许可证不自动变更该应用的许可。
- 0.6.0 发布时，GitHub 框架和示例仓库均为私有。之后两个仓库分别更名并公开，随后示例和文档站统一并入 [dou-bot](https://github.com/abandon-jw3/dou-bot) 的 `apps/example/` 与 `website/`，原仓库保留迁移入口与历史。公开教程和更多可运行示例见 [用户文档](https://abandon-jw3.github.io/dou-bot/)。

本次命令明确使用 `--tag next`，但 registry 返回的实际状态为 `next`、`latest` 都指向 0.6.0。完成账号验证后尝试移除 latest，registry 返回 HTTP 400，复查标签未变。此结果已记录，不将其写成“只有 next”。项目使用精确依赖 `dou-bot@0.6.0`；0.6.0 不带 prerelease 后缀，标签本身不构成生产验收承诺。

## 后续发行需说明的变更

以下属于 0.6.0 发布后的源码变更，尚未发布到 npm：

- 2026-10-01，所有者明确统一采用 MIT；独立业务示例已补齐 LICENSE、NOTICE 与 package.json 的许可字段。既有 SDK 和上游声明继续保留。

- `dou-bot/testing` 增加 `TestAdmission` 类型导出，已有 `enqueue()` / `dispatch()` 行为不变。
- 附件 API 已收敛为 Attachments / Images、AttachmentOptions，以及 selectAttachments、AttachmentKind、AttachmentSelectionOptions / AttachmentSelectionResult；Attachment 保留 voiceWavUrl / asrReferText。公开契约为 1.10，早期未发布的 Videos / Audios / Files 已移除，源码消费者改为显式 prompt 后筛选。当前 tarball 验证新功能，不回写历史 0.6.0 消费者；发布后再同步业务示例、网站 API 索引和技能。
- 新增 User、UserId、Group、GroupId、Role 身份参数装饰器与 UserInfo / GroupInfo，公开契约继续修订为 1.9。仅从当前事件注入冻结快照，命令和按钮共用；缺失信息保持 undefined，现有 Context 接口不变。身份专用消费者同样只验证当前 tarball。
- 新增 OnAttachment / OnAttachmentOptions 自动附件路由，当前公开契约为 1.11。按同一附件组合筛选，多个处理器独立顺序执行；GuardContext.kind 新增 attachment / matchedAttachments，ErrorPhase 增加 attachment。发行迁移说明需提醒显式判断 button 分支，不能将 command 之外的情况都当作按钮。新功能消费者只验证当前 tarball；业务示例、网站和技能仍使用 npm 0.6.0。
- SDK 的 Node 支持范围明确为 `>=24.0.0 <25`，开发使用 `.nvmrc` 的 24.21.0。0.6.0 的 `>=24` 元数据不会被改写；运行 Node 25 及更高主版本的消费者升级新 SDK 前需切换到 24.x。发行说明必须包含此安装兼容性收紧。

## 检查并生成候选

在框架根目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
npm pack --pack-destination work/release/0.7.0
```

先创建 `work/release/0.7.0` 目录。`prepack` 会重新构建，避免打入旧产物；在工程目录执行 publish 时，`prepublishOnly` 会执行完整 check。包检查内部使用 `pack --ignore-scripts`，避免递归执行生命周期。

包检查验证入口和类型存在、许可与文档完整、相对文档链接没有离开安装包、文件白名单和本地已知 QQ 密钥未被打包；再在独立消费者中安装实际 tgz，用传统装饰器编译并执行。消费者不依赖框架 checkout 或未声明的 @types/ws。

候选验收阶段将同一 tgz 安装到独立示例项目，记录 SHA-256 与来源提交并运行完整 check。发布后改为精确 registry 依赖，vendor/sdk.json 保存下载地址、integrity 及原候选来源，不再携带重复的 tgz。

检查 tarball 的发布预览（无上传）：

```sh
npm publish ./work/release/0.7.0/dou-bot-0.7.0.tgz --dry-run --ignore-scripts --access public --tag latest --registry=https://registry.npmjs.org/
```

`--ignore-scripts` 是对已经单独检查过的 tarball 预览；不能把预览当成完成完整检查。保存候选 SHA-256、来源提交和测试结果；修改文件后应重新构建和核对，避免发布与验收不同的内容。

## 发布账号与操作

发布前已核对账号 fine_wei、包名和验收包 SHA-256。用户明确授权发布，并完成 npm 要求的浏览器账号验证；CLI 返回 `+ dou-bot@0.6.0`。

在自己的终端完成 `npm login --registry=https://registry.npmjs.org/`，随后用 `npm whoami` 核对账号。账号需要满足 npm 当时的发布验证要求；无需把 token、密码或一次性验证码写进仓库或聊天。

本次发布使用已经完整验收的 tgz，执行命令如下。0.6.0 已存在，不要再次执行此命令试图覆盖；后续发行应使用新的版本号和对应候选文件：

```sh
npm publish ./work/release/dou-bot-0.6.0.tgz --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```

同一个名称和版本发布后不能重新覆盖。0.6.0 发布时源码仓库为私有，该版本没有生成 npm provenance。之后公开仓库不会追溯改变已经发布的包；后续发行可另行配置来源证明。参见 [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) 和 [trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

## 发布后验证

- registry 上的名称、版本、MIT、tarball URL 和 SHA-512 integrity 已核对；上传字节与验收候选一致。
- 使用空 npm 用户配置和全新缓存，在独立目录从官方 registry 下载精确版本；编译 README 的三个 TS 文件并运行离线问候断言，再通过两项技能示例测试。编译输入全部位于该独立安装内，未借用框架源码或父目录类型包。
- 独立示例迁移为 `dou-bot: "0.6.0"`，锁文件使用官方 tarball URL 和相同 integrity；运行完整 check 后再推送。其 vendor 目录保留发行来源记录。
- 源码版本标签 `v0.6.0` 指向生成发布包的提交 `29a18040e1df2f8d06af8bf85a9c5879736b020e`。后续文档状态更新不会改写这个标签或已经发布的包。

## 当前功能验收边界

WS 已有 Windows 和 macOS 下的群聊与私聊实机验证。2026-10-06 使用发布版 0.6.0，在本次测试机器人与群中完成群主、管理员、普通成员的角色字段、命令权限及管理者回调按钮允许/拒绝验证。Webhook 完成本地真实 HTTP、签名与两种接入对照；公网 HTTPS 回调仍待验。此结论不扩展到所有账号、其他按钮类型的权限或多日生产运行。完整历史见 [验证记录](validation-report.md)。
