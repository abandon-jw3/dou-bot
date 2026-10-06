# 离线测试

不连接 QQ，也可以检查命令是否回复正确、错误输入是否被拒绝、按钮是否执行了预期操作。`createTestApplication` 会运行你的业务模块，并用内存记录代替 QQ 的消息发送，无需机器人凭证。

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

终端应输出 `你好，小明！`；断言失败会让程序报错。你可以替换 content 和预期回复来测试其他输入，也可以把这些断言放进 Node 的 `test()` 中组织测试用例。

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

## 为自己的业务补充检查

除了正常输入，还应检查缺少参数、没有权限、连续调用触发冷却、外部服务失败等情况。确认回复内容的同时检查 errors，避免处理器抛错后测试仍被当作成功。

这类测试验证你的业务逻辑。连接 QQ 后，再检查账号的消息投递权限、图片和按钮的客户端显示；使用 Webhook 时还需检查 HTTPS 回调。测试工具的完整选项见 [测试入口 API](../api/testing.md)。
