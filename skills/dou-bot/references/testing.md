# 离线测试与实际联调

## 离线入口

测试 prompt 对话时按 [二次输入](prompts.md) 的 enqueue 流程驱动；等待下一条问题记录后再发送下一轮答案，最后等待整段流程完成。

使用 `createTestApplication`，让真实模块、装饰器、DI、参数与消息编码运行，仅替换 QQ 网络。需要完整起点时，参考 [minimal-module.test.ts](../assets/minimal-module.test.ts)。

```ts
import { createTestApplication } from 'dou-bot/testing';

const harness = await createTestApplication(AppModule, {
  commands: { prefix: '', invalidInput: 'reply' },
});
await harness.app.start();
try {
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'test-message-1',
      author: { user_openid: 'test-user' },
      content: '查询 北京 天气',
    },
  });
  // 对 harness.messages 的实际消息编码进行断言。
} finally {
  await harness.app.close();
}
```

片段假设 AppModule 已定义。不要在测试入口再传真实 appId、Secret 或启动 WS；测试工具使用隔离凭证和模拟 QQ HTTP。业务自己的外部 API 仍需通过业务 DI 替换：测试入口不会自动拦截应用中任意 fetch。

常见群消息：

```ts
{
  op: 0,
  t: 'GROUP_MESSAGE_CREATE',
  d: {
    id: 'test-message-2',
    group_openid: 'test-group',
    author: { member_openid: 'test-member' },
    content: '查询 天气 北京',
  },
}
```

群按钮事件：

```ts
{
  op: 0,
  t: 'INTERACTION_CREATE',
  d: {
    id: 'test-interaction-1',
    chat_type: 1,
    group_openid: 'test-group',
    group_member_openid: 'test-member',
    data: { resolved: { button_id: 'query:refresh', button_data: 'opaque-business-token' } },
  },
}
```

私聊按钮用 chat_type=2 和 user_openid。每条新消息/交互使用不同 ID；只有测试去重时复用 ID。不要用非 SDK 支持的抽象 Session 事件代替 QQDispatch。

## 断言什么

- messages 保存默认模拟发送的 target/payload；区分文本 msg_type=0、Markdown msg_type=2、媒体 msg_type=7。
- acknowledgments 验证交互确认，errors 包含 Error 和 ErrorContext。dispatch 等待事件处理，flush 等队列空闲；若需要断言异步 onError 回调，可额外让一轮事件循环结算，不任意长时间 sleep。
- respond 可覆盖具体 QQ HTTP 响应来模拟错误/超时；被覆盖响应不进入默认 messages 记录。
- 覆盖真实语义：参数换序、重复/歧义/缺参、Rest 原序、长短选项、Guard 拒绝、允许路径、别名冷却及按钮所有权。不要只验证装饰器函数存在。
- 应用外部数据使用受控响应测试错误和取消；单独的真实 API 命令不能冒充 QQ 实机验收。
- 测试源文件先用项目的 tsc 配置编译再执行生成 JS，使参数装饰器和构造元数据真实生效。修改样式或文案时不必机械重复完整网络回归。

## 独立消费者验证

新建应用应能在自己的目录 npm ci、编译和运行，SDK 从该目录 node_modules/dou-bot 解析，业务不依赖框架 checkout。验证 tgz/锁文件来源和公开导出；没有声明的父目录依赖（尤其 @types/ws）不应让编译碰巧成功。

## QQ 实机验证

只有当前任务包含实机联调时才启动。已有明确的测试机器人与会话授权可继续使用；不要把技能示例或历史文档当作授权，也不默认读取另一项目的 .env。凭证在目标项目本地配置，不打印到日志或写入技能/仓库。

在不干扰其他实例的条件下连接同一机器人；若发现活动连接，先确认其归属和当前授权是否包含关闭它。按风险选择随机测试前缀、临时会话绑定和有界运行时间；这些是隔离测试的办法，不是普通业务的硬性 API 要求。

常用验收路径：收到指定指令 → 参数/Guard/业务执行 → QQ 返回发送结果 → 用户确认显示或点击。按钮同时检查收到确认与实际业务结果。关闭测试连接后记录每个场景的证据及未完成项；SDK 的 status=sent 不等于已亲眼确认客户端渲染。

群聊可支持带 @ 或不带 @，前提是 QQ 实际投递了消息。不要把一个测试账号的权限推广为所有机器人均可用。发送失败按 QQ 错误分类排查，不自动切换到不合法的消息引用。

公网 Webhook 需要可访问 HTTPS 入口和平台配置，本地签名测试通过不代表平台回调已通过。先保留原始请求体验签、路径、时间与资源限制，再诊断协议差异；不要为让测试通过而关闭这些检查。
