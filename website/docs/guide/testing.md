# 离线测试

从 dou-bot/testing 导入 createTestApplication，用真实模块、DI、命令解析和消息编码替换 QQ 网络。它不需要真实机器人凭证。

## 最小测试

下面的 AppModule 来自 [hello 示例](../examples/hello.md)。

<<< @/../examples/offline.ts

预期输出：`你好，小明！`。也可以把同样的断言放到 Node 内置 test 中运行。

## 事件输入

每条新消息使用不同 id；只有验证重复投递时复用 ID。

```ts
const privateEvent = {
  op: 0,
  t: 'C2C_MESSAGE_CREATE',
  d: {
    id: 'MESSAGE_ID',
    author: { user_openid: 'USER_OPENID' },
    content: '/hello 小明',
  },
};
const groupEvent = {
  op: 0,
  t: 'GROUP_MESSAGE_CREATE',
  d: {
    id: 'ANOTHER_MESSAGE_ID',
    group_openid: 'GROUP_OPENID',
    author: { member_openid: 'MEMBER_OPENID' },
    content: '/hello 小明',
  },
};
```

需要显式类型时标注 QQDispatch，避免 op 被推断成任意 number。

## 观察结果

- messages 保存默认模拟发送的 target 和 QQ payload。
- acknowledgments 保存 interactionId 与确认 code。
- errors 保存 Error 与 ErrorContext；事件被接纳不代表业务成功。
- enqueue 立即返回接纳状态；被接纳或去重的结果带 done。
- dispatch 等待该事件对应的处理完成；flush 等待整个队列空闲。

respond 可覆盖指定 HTTP 响应，以模拟发送失败或限流。覆盖后的请求不会进入默认 messages 记录。业务服务自行发起的外部 HTTP 不会自动被这个测试入口替换，应通过 DI 注入可控制的数据源。

## 对话测试

prompt 要先 enqueue 问题，观察到模拟发送，再 enqueue 回答。不能先 await dispatch(开始对话) 再发送回答，否则驱动会等待尚未结束的父流程。

第一轮回答的 done 也可能要等整个对话完成；观察到第二条问题后再发送下一条回答。参考 [两轮问答](../examples/prompt.md)。

## 运行本仓库验证

```sh
npm ci
npm test
```

测试源代码位于 [tests/examples.test.ts](https://github.com/abandon-jw3/dou-bot-docs/blob/main/tests/examples.test.ts)，编译器确实生成传统装饰器与元数据后才执行。测试与实际 QQ 客户端显示、权限和公网回调是不同层面的验收。
