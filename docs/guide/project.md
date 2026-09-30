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

package.json 使用 `"type": "module"`。TypeScript 源码的相对导入写生成后的 `.js` 扩展名，例如 `./app.module.js`。自动构造注入的类必须作为值导入，接口或纯类型使用 `import type`。

普通业务从 `dou-bot` 导入，测试从 `dou-bot/testing` 导入。不要导入 `dou-bot/dist/...`，也不要指向本机框架源码目录。

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

生产机器先安装依赖并构建，再运行生成的 JavaScript。若在部署端移除开发依赖，要在移除 TypeScript 前完成构建，或直接部署已构建产物。文档仓库的 `examples:build` 是该仓库自己的示例命令，不是 SDK 自动提供的命令。
