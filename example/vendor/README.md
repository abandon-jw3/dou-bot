# SDK 快照

- 本项目使用尚未发布的新版本 API，通过 `npm ci` 安装本目录的独立 tarball。
- `sdk.json` 记录来源状态、契约、SHA-256、npm integrity 和编译产物指纹。
- 当前包版本为 1.0.0-rc.0，尚未上传 npm；发布后再切换到相同版本的 registry 包。
- `npm run verify:sdk` 检查包、锁文件和实际安装内容；不使用源码链接。
- 发布正式版本后，再固定对应 npm 版本并更新锁文件。
