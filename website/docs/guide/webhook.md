# Webhook 接入

- QQ 通过 HTTP 向应用投递事件。
- 需要 QQ 可访问的 HTTPS 地址；没有公网入口时使用 [WebSocket](./ws.md)。

::: warning 0.7.0 的接入状态
公网 QQ 回调尚未完成端到端验证；使用前先完成下方连接检查。
:::

## 独立监听

在快速开始的 options 中替换 transport：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

- `await app.start()` 后监听本地 HTTP，默认只监听 127.0.0.1。
- 用反向代理提供 HTTPS，并转发到配置的端口和路径。
- 在 QQ 平台填写公网回调 URL。

## 保留请求原文

- 框架负责地址验证、Ed25519 验签、签名时间与请求大小检查。
- 代理保留路径、查询参数、签名头和正文原始字节。
- 不要提前执行 JSON body parser、重新序列化正文或改变编码。

## 挂载到自有 HTTP server

设置 `transport: { type: 'webhook', listen: false }` 创建 app，然后挂载：

```ts
import { createServer } from 'node:http';

await app.start();
const callback = app.webhookHandler();
const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(app.status === 'running' ? 200 : 503);
    response.end(app.status);
    return;
  }
  callback(request, response); // 请求体此前未被读取，URL 也没有重写。
});
server.listen(3000, '127.0.0.1');
```

- 完成 `app.start()` 后再接收流量。
- 退出时停止接流量、`await app.close()`，再关闭自己的 server 和连接。
- app.close 不会销毁宿主的共享 server。

## 确认与业务完成

- HTTP 接纳成功不表示业务已经完成。
- 平台重复投递会进行进程内去重。
- 接纳后进程崩溃可能丢失未处理任务，重要业务需持久化和幂等检查。

## 检查连接是否可用

1. 确认 HTTPS 地址能转发到指定 host、port、path。
2. 在 QQ 平台完成地址验证；失败时检查 Secret、签名头和原始正文。
3. 测试私聊、群聊命令和需要使用的按钮回调。
4. 确认重复事件不会重复修改业务数据。

完整配置默认值见 [配置指南](./configuration.md)，常见连接错误见 [排错指南](./troubleshooting.md)。
