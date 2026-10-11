# Windows 部署

先按 [快速开始](./quick-start.md) 确认能正常收发。本文使用 Node.js **24.21.0**、npm **11.19.0** 和 TypeScript **5.9.3**。

## 部署内容

- 业务源码、package.json、package-lock.json、编译配置。
- 本机 `.env`，不提交凭证。
- 使用已构建版本时，保留 `dist/` 并安装生产依赖。

从源码部署：

```sh
npm ci
npm run build
npm start
```

build/start 脚本见 [项目结构](./project.md#推荐脚本)。

## 运行与退出

- 首次前台运行，确认连接和错误输出。
- 持续运行时，明确进程的工作目录、环境文件、重启策略和退出期限。
- 保留 SIGINT/SIGTERM 到 `app.close()` 的关闭逻辑。
- 更新时先停旧进程，再启动新进程，避免同一机器人重复建立 WS 连接。

## 观测状态

- `app.status` / `app.snapshot()`：查看连接、重连、队列和 prompt。
- `logger` / `onError`：记录错误码、阶段和必要业务信息。
- 进程存在不代表 QQ 已连接；日志避免记录完整原始消息或凭证。

## Webhook 部署额外要求

- 提供 QQ 可访问的 HTTPS 地址，转发到 SDK 的 HTTP 端口。
- 保留请求原文和签名头，按 [Webhook 指南](./webhook.md) 检查连接。

## 升级与回退

- 指定明确版本，阅读更新日志，重新编译并运行自己的测试。
- 保留上一版锁文件和构建产物用于回退。
- 重启会重置对话、冷却、队列和去重；持久化数据由业务管理。
- WS、Webhook 均不提供跨进程的恰好一次保证，修改数据需幂等处理。
