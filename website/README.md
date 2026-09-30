# dou-bot 用户文档

[在线手册](https://abandon-jw3.github.io/dou-bot/) · [npm 0.6.0](https://www.npmjs.com/package/dou-bot/v/0.6.0) · [问题反馈](https://github.com/abandon-jw3/dou-bot/issues)

基于 VitePress 1.6.4 默认主题的中文使用手册，面向 QQ 官方机器人群聊和私聊。API 和示例以公开发布的 dou-bot 0.6.0 为准。

工具依赖通过 scoped override 固定 Vite 6.4.3，锁文件使用 esbuild 0.25.12；版本评估与维护条件见 [文档工具依赖维护](../docs/repository.md#文档工具依赖维护)。

## 本地开发

环境：Node.js 24.x（最低 24.21.0）、npm 11.19.0；仓库开发版本由根目录 `.nvmrc` 指定。示例编译器固定为 TypeScript 5.9.3。在主仓库的 `website` 目录执行：

```sh
npm ci
npm run dev
```

终端会显示本地地址，站点基础路径为 /dou-bot/。生产构建与预览：

```sh
npm run build
npm run preview
```

## 目录职责

| 目录 / 文件            | 作用                                                     |
| ---------------------- | -------------------------------------------------------- |
| docs/guide/            | 从安装到部署、排错的用户教程                             |
| docs/api/              | 装饰器、客户端、上下文和类型参考                         |
| docs/examples/         | 完整示例的讲解与运行步骤                                 |
| docs/.vitepress/       | 默认主题、中文导航、本地搜索、Pages base 配置            |
| docs/public/           | 无需构建转换的静态资源                                   |
| examples/              | 真正参与 TypeScript 编译的示例源代码，文档引用同一份文件 |
| tests/                 | 使用已安装 SDK 的离线业务断言，不需要真实 QQ 凭证        |
| browser-tests/         | 桌面与手机的导航、搜索、主题、复制和直接访问检查         |
| scripts/               | 示例构建、公共 API 索引生成及内容/产物链接校验           |
| ../.github/workflows/  | 主仓库统一的 Windows/Linux 检查和 Pages 部署             |
| tsconfig.examples.json | 传统装饰器及元数据的 Node ESM 编译配置                   |
| tsconfig.site.json     | 文档配置与浏览器测试的类型检查                           |
| package-lock.json      | 锁定站点、SDK 和测试工具依赖                             |

生成的 .examples-build、docs/.vitepress/dist/cache 不提交。真实 .env 始终留在本地；可以从 examples/.env.example 复制占位配置后自行填写。

## 修改和验证

```sh
npm run format
npm audit --audit-level=moderate
npm run check
npx playwright install chromium
npm run test:browser
```

check 包含类型、格式、API 索引、链接、示例测试和站点构建。Playwright 使用 1.63.0，启动生产预览验证桌面和手机；CI 在 Linux 安装 Chromium 及所需系统库。

浏览器输出默认写入系统临时目录。DOCS_QA_DIR 可指定证据目录；DOCS_ORIGIN 可指定已部署站点的 origin，用同一套检查复验线上站点。

## 更新 SDK 文档版本

1. 确认目标版本已经公开发布，再修改精确 SDK 依赖和所有版本说明。
2. 运行 npm run api:generate 更新来自安装包的公共声明；检查生成器的版本约束。
3. 更新教程与示例，对照参数默认值和行为变化，保留中文说明。
4. 运行完整 check 与 browser 检查，更新变更记录，推送 main。

不要从本机其他框架目录导入代码，也不要把尚未发布的类型当成当前 npm API。API 索引生成器只读取已安装的发布包；手写业务示例也在这个包上编译和执行。

## 部署

主仓库 `abandon-jw3/dou-bot` 的 Pages Source 设为 GitHub Actions。每次 main 提交先完成 SDK、独立示例、文档的双平台检查和 Linux 浏览器测试，再将 `website/docs/.vitepress/dist` 部署到 Pages；PR 只检查，不部署。

固定 base 为 /dou-bot/。如果以后改变仓库名或使用独立域名，需要同步 base、站点 hostname、favicon 和浏览器 baseURL，再验证所有深层页面。

在主仓库根目录也可以使用 `npm run docs:dev`、`npm run docs:build`、`npm run docs:check` 和 `npm run docs:test:browser`。本站仍独立安装 npm 上的 `dou-bot@0.6.0`，不会自动链接当前 SDK 源码。原 `/dou-bot-docs/` 地址保留页面跳转，新内容统一在本目录维护。

文档与新编写示例采用 [MIT](LICENSE)。框架协议与权限的验收边界见在线手册，不将离线断言视为所有账号都已通过实机测试。
