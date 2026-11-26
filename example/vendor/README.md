# SDK 来源记录

本项目通过随仓携带的独立压缩包 `vendor/dou-bot-source.tgz` 安装 `dou-bot@1.0.0`。运行 `npm ci` 即可按锁文件安装。

`sdk.json` 记录版本号、安装包 SHA-256 / integrity 与 `dist` 内容指纹。运行 `npm run verify:sdk` 可核对锁文件与实际安装内容。
