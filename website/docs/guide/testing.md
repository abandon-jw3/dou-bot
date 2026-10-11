# 离线测试

- `createTestApplication` 运行你的业务模块，无需 QQ 凭证。
- 消息发送和按钮确认写入内存记录。
- 可测试正常输入、参数错误、权限拒绝、冷却和外部请求失败。

## 最小测试

先准备 [hello 示例](../examples/hello.md) 中的业务文件，在同一个项目中创建 `src/offline.ts`：

```ts
import assert from 'node:assert/strict';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from './app.module.js';

const bot = await createTestApplication(AppModule);
await bot.app.start();
try {
  await bot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'message-1', author: { user_openid: 'user-1' }, content: '/hello 小明' },
  });
  assert.equal(bot.messages[0]?.payload.content, '你好，小明！');
  assert.equal(bot.errors.length, 0);
  console.log(bot.messages[0]?.payload.content);
} finally {
  await bot.app.close();
}
```

在你的项目根目录编译并运行，不需要 `.env`：

```sh
npx tsc -p tsconfig.json
node dist/offline.js
```

- 预期输出 `你好，小明！`，断言失败会报错。
- 替换 content 和预期回复即可测试其他命令；多用例可放入 Node 的 `test()`。

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

- `respond` 可模拟 QQ 发送失败或限流；覆盖的请求不进入默认 messages 记录。
- 自己的外部请求需另行替换，可通过 DI 注入测试数据源。

## 对话测试

1. enqueue 起始命令，观察问题发送记录。
2. enqueue 回答；多轮时等下一条问题出现再继续回答。
3. 最后等待 done 或 flush。

不要先等待起始命令的 dispatch 或第一轮回答的 done，它们可能要等整段对话结束。见 [两轮问答](../examples/prompt.md)。

## 为自己的业务补充检查

- 同时断言回复内容与 errors，接纳成功不代表业务成功。
- 连接 QQ 后另行检查账号权限、图片和按钮显示，以及需要使用的 HTTPS 回调。
- 完整选项见 [测试入口 API](../api/testing.md)。
