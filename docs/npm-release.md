# dou-bot 的首次 npm 发布准备

状态：发布候选已选定为 **dou-bot@0.6.0**，采用 **MIT**，拟发布到官方 npm registry 的 **next** 标签。本文是准备流程，不代表版本已经上架。

## 已确定的发行内容

- 原开发名 dd-bot 在 npm 上属于其他项目；新包名为 dou-bot，代码导入为 `dou-bot`、`dou-bot/testing`。GitHub 仓库名及 `$dd-bot` 技能调用名保留。
- TypeScript 5.9.3、Node.js 24+、ESM。生产直接依赖仍只有 reflect-metadata 和 ws，版本沿用锁定配置。
- 包内包含 dist 的 JavaScript、类型声明及源码映射，README、MIT LICENSE、NOTICE 和五份使用指南。源码映射包含框架源代码；不包含凭证、测试日志、开发脚本或设计草案。
- 保留 @satorijs/adapter-qq 的适用 MIT 声明。独立示例应用仍为 private，框架许可证不自动变更该应用的许可。
- GitHub 框架和示例仓库保持私有。用户可离线阅读安装包中的使用指南，GitHub 源码、Issue 和更多示例链接需要仓库权限。

`next` 是 npm 分发标签，0.6.0 本身不带 prerelease 后缀；当前不设置 latest。首次发布后需显式使用 `npm install dou-bot@next` 或精确版本。是否切换为 latest 在后续稳定发行时决定。

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

另将同一 tgz 安装到独立示例项目，更新 vendor/sdk.json 的包名、文件名、SHA-256 与来源提交，运行其完整 check。正式发布之前可继续使用本地 tgz，不提前把未存在的 npm 版本写进示例锁文件。

检查 tarball 的发布预览（无上传）：

```sh
npm publish ./work/release/dou-bot-0.6.0.tgz --dry-run --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```

`--ignore-scripts` 是对已经单独检查过的 tarball 预览；不能把预览当成完成完整检查。保存候选 SHA-256、来源提交和测试结果；修改文件后应重新构建和核对，避免发布与验收不同的内容。

## 正式发布前仍需完成

2026-09-30 的 registry 查询没有找到公开的 dou-bot 包，但这不是名称预留，也不能保证注册局一定接受发布。同日 `npm whoami` 返回 ENEEDAUTH，当前 npm CLI 尚未登录。

在自己的终端完成 `npm login --registry=https://registry.npmjs.org/`，随后用 `npm whoami` 核对账号。账号需要满足 npm 当时的发布验证要求；无需把 token、密码或一次性验证码写进仓库或聊天。

本次任务是发布准备。确认要公开发布这个名称、版本、标签和候选包之后，才执行：

```sh
npm publish ./work/release/dou-bot-0.6.0.tgz --ignore-scripts --access public --tag next --registry=https://registry.npmjs.org/
```

同一个名称和版本发布后不能重新覆盖。私有源码仓库当前不具备 npm 自动 provenance 的公开仓库条件，因此没有启用自动发布或声明生成来源证明。参见 [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/) 和 [trusted publishing](https://docs.npmjs.com/trusted-publishers/)。

## 发布后验证

1. 查询 `npm view dou-bot@0.6.0 version license dist-tags dist.integrity --json --registry=https://registry.npmjs.org/`，核对精确版本和 next 标签。
2. 在新目录直接从 registry 安装 dou-bot@0.6.0，编译并运行 README 的离线示例；这一步才验证公开安装链路。
3. 将独立示例的本地 vendor 依赖切换到精确 npm 版本，更新锁文件并跑 check；保留旧包来源记录。
4. 记录实际发布账号、时间、registry integrity 和对应 Git 提交；按需创建版本标签与发布记录。此步骤不在准备阶段提前执行。

## 当前功能验收边界

WS 已完成 Windows 下群聊和私聊实机验证。Webhook 完成本地真实 HTTP、签名与两种接入对照；公网 HTTPS 回调仍按用户决定待验。群角色投递和管理者按钮对不同角色的实际拦截还需专项实机验收。它们已在公开 README 中明确，不能记为全部生产场景已验证。完整历史见 [验证记录](validation-report.md)。
