# 文档站维护

面向新建机器人项目，介绍 **1.0.0-rc.0 候选试用版**：AppFactory、多账号、PostgreSQL 与性能观测。

## 预览与检查

环境：Node 24.21.0、npm 11.19.0、TypeScript 5.9.3。

```sh
npm ci
npm run dev
npm run check
npm run test:browser
```

- 页面在 docs，参与编译的代码在 examples，离线断言在 tests。
- check 包含 SDK 来源、类型、格式、API 索引、链接、测试和构建。
- 浏览器测试检查桌面/手机导航、搜索、代码复制与页面渲染；首次安装 Chromium：`npx playwright install chromium`。
- 临时产物不提交；真实 .env 不进入仓库。

## SDK 来源

- 精确安装 npm dou-bot@1.0.0-rc.0；[vendor](vendor/README.md) 记录来源与完整性，不链接 framework 源码。
- 本站对应已发布的 1.0.0-rc.0 候选试用版；next 指向此版本，latest 仍为 0.8.0。
- API 索引从实际安装的公开声明生成：`npm run api:generate`。
- 验证尚未发布的新 API 时，才在 framework 执行 `node scripts/prepare-user-sdk.mjs`，在 example 执行 `npm install --save-exact --ignore-scripts ./vendor/dou-bot-source.tgz`，在 website 执行同一命令并加 `--save-dev`，更新索引并验证。
- 更新时核对实际 registry 版本与完整性，再同步锁文件和页面版本。未发布功能的验证与正式依赖更新分开进行。

## 编写方式

- 读者是开发 QQ 机器人的使用者，页面只回答如何安装、配置、编写业务、排错和运行。
- 开头说明能完成什么，随后给出操作步骤、可复制代码与必要限制；按功能分点。
- 安装教程统一使用配套示例；保持步骤可运行，不把未发布 API 写成 npm 0.8.0 的能力。
- 打包、tarball、来源指纹、API 生成、CI、候选与历史验收进度留在本 README、vendor 说明或 framework/docs 的维护记录中。
- 不把内部压测配置当作用户默认配置；容量指南讲用户如何测量自己的业务。
- 版本与试用状态在首页和导航简短标明，功能页不反复讲发行过程。
- 示例使用用户自己的项目路径；确需说明参数默认值、错误行为和平台限制时，直接解释使用影响。
- 历史发布记录保留；用户教程不写旧版迁移流程。

## 部署

- VitePress 1.6.4，Pages base 保持 `/dou-bot/`。
- main 的 CI 成功后由现有工作流部署；本地文档修改不代表已上线。
- 主题和工具依赖说明见 [仓库文档](../framework/docs/repository.md#文档工具依赖维护)。
- 可从根目录执行 docs:dev/build/check/test:browser。
- 文档与示例采用 [MIT](LICENSE)。
