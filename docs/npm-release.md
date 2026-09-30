# dou-bot 的 npm 发布记录与流程

状态：**dou-bot@0.6.0 已于 2026-09-30 13:47（Asia/Shanghai）公开发布到 npm**，许可证为 MIT，发布账号为 fine_wei。完整性、来源提交与验证记录见 [发布记录](npm-release-0.6.0.json)，包页面见 [npm](https://www.npmjs.com/package/dou-bot/v/0.6.0)。

## 已确定的发行内容

- 原开发名 dd-bot 在 npm 上属于其他项目；新包名为 dou-bot，代码导入为 `dou-bot`、`dou-bot/testing`。GitHub 框架仓库后续更名为 dou-bot，`$dd-bot` 技能调用名保留。
- TypeScript 5.9.3、Node.js 24+、ESM。生产直接依赖仍只有 reflect-metadata 和 ws，版本沿用锁定配置。
- 包内包含 dist 的 JavaScript、类型声明及源码映射，README、MIT LICENSE、NOTICE 和五份使用指南。源码映射包含框架源代码；不包含凭证、测试日志、开发脚本或设计草案。
- 保留 @satorijs/adapter-qq 的适用 MIT 声明。独立示例应用的 `package.json` 保留 `"private": true` 以禁止误发布到 npm；该字段不影响 GitHub 仓库可见性，框架许可证不自动变更该应用的许可。
- 0.6.0 发布时，GitHub 框架和示例仓库均为私有。之后两个仓库分别更名并公开，随后示例和文档站统一并入 [dou-bot](https://github.com/abandon-jw3/dou-bot) 的 `apps/example/` 与 `website/`，原仓库保留迁移入口与历史。公开教程和更多可运行示例见 [用户文档](https://abandon-jw3.github.io/dou-bot/)。

本次命令明确使用 `--tag next`，但 registry 返回的实际状态为 `next`、`latest` 都指向 0.6.0。完成账号验证后尝试移除 latest，registry 返回 HTTP 400，复查标签未变。此结果已记录，不将其写成“只有 next”。项目使用精确依赖 `dou-bot@0.6.0`；0.6.0 不带 prerelease 后缀，标签本身不构成生产验收承诺。

## 检查并生成候选

在框架根目录运行：

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
npm pack --pack-destination work/release
```

先创建 `work/release` 目录。`prepack` 会重新构建，避免打入旧产物；在工程目录执行 publish 时，`prepublishOnly` 会执行完整 check。包检查内部使用 `pack --ignore-scripts`，避免递归执行生命周期。

包检查验证入口和类型存在、许可与文档完整、相对文档链接没有离开安装包、文件白名单和本地已知 QQ 密钥未被打包；再在独立消费者中安装实际 tgz，用传统装饰器编译并执行。消费者不依赖框架 checkout 或未声明的 @types/ws。

候选验收阶段将同一 tgz 安装到独立示例项目，记录 SHA-256 与来源提交并运行完整 check。发布后改为精确 registry 依赖，vendor/sdk.json 保存下载地址、integrity 及原候选来源，不再携带重复的 tgz。

检查 tarball 的发布预览（无上传）：

```sh
npm publish ./work/release/dou-bot-0.6.0.tgz --dry-run --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
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

WS 已完成 Windows 下群聊和私聊实机验证。Webhook 完成本地真实 HTTP、签名与两种接入对照；公网 HTTPS 回调仍按用户决定待验。群角色投递和管理者按钮对不同角色的实际拦截还需专项实机验收。它们已在公开 README 中明确，不能记为全部生产场景已验证。完整历史见 [验证记录](validation-report.md)。
