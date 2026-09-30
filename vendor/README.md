# SDK 依赖

项目通过 `file:vendor/dd-bot-0.6.0.tgz` 安装 SDK，业务代码只使用 `dd-bot` 和 `dd-bot/testing` 的公开入口。

SDK 尚未发布 npm，因此在私有示例仓库保存经过凭证检查的安装包，配合 package-lock.json 保证克隆后能够直接 npm ci。无需跨私有仓库下载权限，也不依赖本机框架源码目录。来源提交与校验值在 sdk.json 中。

更新时用框架工程的 npm pack 生成新安装包，更新依赖路径、sdk.json 和锁文件，再运行 npm run check。SDK 自带 NOTICE，当前发行许可仍由项目所有者决定。
