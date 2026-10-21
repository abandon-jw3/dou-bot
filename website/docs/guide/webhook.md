# Webhook 接入

QQ 向公网入口投递事件，应用负责验签和接纳。多个账号共用一个监听端口，路径按账号区分。

## 配置

在 `AppFactory.create()` 中配置：

```ts
bots: [{ appId, secret, transport: { type: 'webhook' } }],
webhook: { host: '127.0.0.1', port: 3000 },
```

- 默认回调路径为 `/qq/<AppID>`，可在账号 transport.path 自定义。
- await app.start() 后开始监听；公网 HTTPS 由 Nginx 等反向代理提供。
- QQ 平台填写公网地址，例如 `https://bot.example.com/qq/<AppID>`。
- 公网入口使用 HTTPS 443，反向代理转发到应用的本机端口。

## 反向代理

配置放在已启用 HTTPS 的 Nginx server 中；替换域名和证书由部署环境完成：

```nginx
location /qq/ {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 1m;
    proxy_read_timeout 15s;
}
```

- proxy_pass 不添加尾部路径，保留原始 URL 和签名头。
- 正文必须保留原始字节；不要先经过 JSON body parser 或重新序列化。
- 框架逐账号核对身份与签名；验签失败/时间戳过期返回 403。
- 正文过大返回 413，读取超时返回 408，验签超时或容量不足返回 503。

## 挂载自有 HTTP 服务

设置 `webhook: { listen: false }`，完成 `app.start()` 后将未读取的请求交给 `app.webhookHandler()`。宿主负责 server 的监听和关闭；app.close() 不关闭宿主 server。

## 检查是否接入成功

1. 在平台保存回调地址并完成验证。
2. 分别实际发送私聊、群聊指令，检查回复。
3. 按业务需求测试按钮、图片、上传和多轮输入。
4. 重复投递、重启与故障恢复另行验证。

- HTTP 200 表示接纳或确认，不表示处理器和回复已完成。
- 去重在进程内，进程崩溃可能丢失已确认任务；关键业务应幂等。
- 完整部署步骤见 [部署与升级](./deployment.md)。
