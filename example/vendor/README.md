# SDK 来源记录

本目录随附 `dou-bot@1.0.0-rc.2` 的候选安装包。运行 `npm ci` 即可按锁文件安装。

`sdk.json` 记录安装包的 SHA-256、SHA-512 完整性以及 `dist` 内容指纹。`npm run verify:sdk` 校验安装包、锁文件和实际安装内容。发布后再将依赖切换到 npm 的精确版本。
