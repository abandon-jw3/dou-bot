# npm 发布流程

仅从仓库的 `framework/` 目录构建、校验并发布 `dou-bot`。CI 只做验证，不自动发布 npm。

## 发布前检查与打包

在 `framework/` 目录执行：

```sh
npm ci --ignore-scripts
npm run check
npm run coverage
mkdir -p work/release/1.0.0
npm pack --pack-destination work/release/1.0.0
```

- `npm run check` 会验证类型、公开 API 契约、ESLint、格式、文档链接、编译产物、自动测试以及独立 tarball 消费者（包含白名单文件校验、包内相对链接校验与本地密钥排除校验）。
- 打包产物只包含 `dist/`、`README.md`、`LICENSE`、`NOTICE` 与白名单使用指南，不包含测试、脚本、本地凭证或维护记录。

## 预览与上传

先用同一份已验收 tarball 执行预览：

```sh
npm publish ./work/release/1.0.0/dou-bot-1.0.0.tgz --dry-run --ignore-scripts --access public --registry=https://registry.npmjs.org/
```

确认文件清单、版本号和完整性校验值无误，完成 `npm login` 并用 `npm whoami` 确认账号后正式发布：

```sh
npm publish ./work/release/1.0.0/dou-bot-1.0.0.tgz --ignore-scripts --access public --registry=https://registry.npmjs.org/
```

## 发布后同步

1. 核对 npm registry 上的版本、tarball 下载地址、SHA-256 与 SHA-512 integrity 与验收产物一致。
2. 将 `example/` 和 `website/` 切换为精确 registry 版本（移除本地 `vendor/dou-bot-source.tgz` 快照），同步 `vendor/sdk.json` 与锁文件。
3. 在 `website/` 运行 `npm run api:generate` 并核对 API 索引与版本文案，在仓库根目录运行 `npm run check:all` 和 `npm run docs:test:browser`。
4. 打上对应版本标签（如 `v1.0.0`）并推送。
