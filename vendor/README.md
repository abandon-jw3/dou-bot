# SDK 来源与校验记录

项目通过 npm 官方 registry 安装精确版本 `dou-bot@0.6.0`，业务代码只使用 `dou-bot` 和 `dou-bot/testing` 的公开入口。克隆后运行 `npm ci --ignore-scripts` 即可安装，无需本机框架源码或本地 tgz。

[sdk.json](sdk.json) 保存发布包版本、registry 下载地址、SHA-512 integrity、来源提交及原候选包 SHA-256。原候选 tgz 已从本项目移除，其内容与 npm 上的发布包一致；来源历史仍保留在 Git 和记录中。SDK 采用 MIT，随包分发 LICENSE 与适用的上游 NOTICE。

`scripts/verify-sdk.mjs` 检查精确依赖、锁文件中的官方 tarball 地址与 integrity、已安装包的名称和版本，以及业务使用的公开导入。npm ci 负责下载与完整性校验。

升级时选择明确版本，更新 package.json、package-lock.json 和 sdk.json 中的来源记录，再运行 npm run check。不要仅修改版本字符串而保留旧 integrity。
