# SDK 来源记录

本项目当前安装由仓库 `framework/` 打包的 `dou-bot@1.1.0` 独立源码快照包（`vendor/dou-bot-source.tgz`）。运行 `npm ci` 即可按锁文件安装。

`sdk.json` 记录版本号、依赖路径、SHA-256 / integrity 与 `dist` 内容指纹。运行 `npm run verify:sdk` 可核对锁文件与实际安装内容。正式发布 `1.1.0` 到 npm registry 后可切换为精确 registry 版本。
