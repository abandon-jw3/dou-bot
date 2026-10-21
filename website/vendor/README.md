# SDK 来源记录

- 本项目通过 npm 官方 registry 精确安装 dou-bot 1.0.0-rc.0。
- sdk.json 保存版本、发行提交、下载地址、完整性及编译产物指纹。
- npm ci 校验下载，npm run verify:sdk 校验锁文件和实际安装内容；无需框架源码或本地 tarball。
- 更新依赖时同步来源记录、锁文件和测试，不使用浮动的 next 标签作为项目依赖。
- 尚未发布的新 API 可通过源码包单独验证，使用 source 记录；不要把本地包标为 registry 版本。
