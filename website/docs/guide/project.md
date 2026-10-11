# 项目结构与编译

## 最小目录

```text
my-qq-bot/
├─ src/
│  ├─ main.ts                # 启动与关闭
│  ├─ app.module.ts          # 注册模块
│  ├─ hello.controller.ts    # 命令入口
│  └─ greeting.service.ts    # 业务服务
├─ .env                     # 本地凭证，不提交
├─ package.json
├─ package-lock.json
└─ tsconfig.json
```

## 增加功能模块

- Controller 接收命令、按钮或附件；Service 处理业务。
- 在 `@Module()` 的 `controllers`、`providers` 中注册对应类。
- 共享服务通过 `exports` 导出，使用方通过 `imports` 引入模块。
- 文件放在同一目录不会自动注册；Controller 不作为共享 Provider。

## ESM 导入规则

- package.json 设置 `"type": "module"`。
- 本手册用 `./app.module.js`；TypeScript 会找到对应的 `.ts` 源文件。
- 要写 `./app.module.ts`，在 tsconfig.json 启用 `"rewriteRelativeImportExtensions": true`；编译后会改成 `.js`。
- 注入的类使用值导入；接口和纯类型使用 `import type`。
- 业务从 `dou-bot` 导入，测试从 `dou-bot/testing` 导入。

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

- `npm run build`：编译到 `dist/`。
- `npm start`：启动机器人。
- 只安装生产依赖时，先在构建环境生成 `dist/`。

## 使用业务示例的开发模式

[完整业务示例](https://github.com/abandon-jw3/dou-bot/tree/main/example) 已提供 `npm run dev`：

- 保存源码或 `.env` 后，自动编译并重启。
- 编译失败时保留上次成功版本。
- 旧进程关闭后才启动新进程；`Ctrl+C` 结束开发会话。
- 重启会清空对话、冷却和去重状态，等启动提示出现后再测试。

从零创建的项目需自行添加开发脚本。
