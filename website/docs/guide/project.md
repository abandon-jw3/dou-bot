# 项目结构与编译

从快速开始得到的业务目录如下：

```text
my-qq-bot/
├─ src/
│  ├─ main.ts                # 凭证、应用创建、启动与关闭
│  ├─ app.module.ts          # 根模块，组装业务
│  ├─ hello.controller.ts    # 命令入口
│  └─ greeting.service.ts    # 可注入的业务服务与配置类型
├─ .env                     # 仅保存在本地的真实凭证
├─ package.json             # 精确依赖和项目脚本
├─ package-lock.json        # 可重复安装的锁文件
└─ tsconfig.json            # ESM、传统装饰器和元数据设置
```

## 增加功能模块

业务增加后，把相关 Controller、Service 和配置放到一个功能目录，再用 `@Module()` 注册。文件位于同一目录不代表自动注册；模块的 imports、providers、controllers、exports 才决定可见性。

共享查询、数据访问等逻辑放在 Service 中。Controller 作为业务入口，不作为跨模块导出的 Provider。

## ESM 导入规则

package.json 使用 `"type": "module"`。本手册的最小项目在相对导入中写生成后的 `.js` 扩展名，例如 `./app.module.js`；TypeScript 会找到对应的 `.ts` 源码。

完整业务示例采用 `.ts` 相对导入，例如 `./app.module.ts`，并在 tsconfig.json 中启用 `"rewriteRelativeImportExtensions": true`。TypeScript 5.9.3 会将生成代码中的路径改为 `.js`，Node.js 仍运行编译产物。若自己的项目也选择 `.ts` 写法，需要同步开启此选项。

自动构造注入的类必须作为值导入，接口或纯类型使用 `import type`。

业务代码从 `dou-bot` 导入，离线测试从 `dou-bot/testing` 导入。这两个入口提供你需要的运行时 API 和类型。

## 推荐脚本

在自己的 package.json 中添加：

```json
{
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "start": "node --env-file=.env dist/main.js"
  }
}
```

添加脚本后，用 `npm run build` 编译，`npm start` 启动。生产机器也使用这两个步骤；若只安装生产依赖，应提前构建好 dist，再连同 package.json 和锁文件一起部署。

## 使用业务示例的开发模式

如果使用仓库中的 [完整业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/apps/example)，在该项目目录运行 `npm run dev`，保存源码后即可自动编译并重启机器人。编译失败时保留上次成功版本；旧进程完成关闭后才启动新进程，按 Ctrl+C 结束开发会话。

开发模式也监听 `.env` 和项目编译配置。每次重启会清空 prompt、冷却和去重状态，等待启动提示后再测试。按本页从零搭建的最小项目不会自动拥有这个脚本；需要时可参考业务示例的开发脚本和 main.ts 关闭处理。
