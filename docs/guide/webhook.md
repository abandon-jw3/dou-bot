# Webhook 接入

Webhook 适合拥有公网 HTTPS 回调入口的部署环境。0.6.0 已完成本地 HTTP、签名和 WS/Webhook 对照测试；公网 QQ 管理端验证、真实投递和重试仍待专项实机验收。

## 独立监听

在快速开始的 options 中替换 transport：

```ts
transport: { type: 'webhook', host: '127.0.0.1', port: 3000, path: '/qq' }
```

await app.start 后，SDK 监听本地 HTTP。由反向代理提供 HTTPS，并将回调路径转发到该地址。默认只监听回环地址；是否需要改变 host 由你的部署拓扑决定。

本地 HTTP 入口本身不是公网 HTTPS 服务。需要在平台配置你实际拥有的回调 URL。

## 保留请求原文

框架处理地址验证、原始字节 Ed25519 验签、签名时间检查、请求大小和读取期限。代理应保留实际路径、查询参数、签名相关头部和正文原始字节。

不要在处理器之前执行 JSON body parser、重新序列化正文或改变编码；不要通过关闭验签或放宽时间检查来掩盖部署差异。

## 挂载到自有 HTTP server

配置 listen: false，在完成 app.start 后将 app.webhookHandler() 作为 Node RequestListener 挂载。下面是组合片段，app 必须已经用 Webhook 配置创建：

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

嵌入模式的 HTTP server 生命周期归宿主所有；退出时宿主要停止接流量、await app.close，并关闭自己的 server 和连接。app.close 不会替宿主销毁共享 server。

## 确认与业务完成

回调被接纳与业务完成是两个阶段。框架先进行协议校验和接纳，再异步执行业务；进程在接纳后崩溃可能丢失尚未处理的任务。平台重复投递会受到进程内去重保护。

完整配置默认值见 [配置指南](./configuration.md)。
