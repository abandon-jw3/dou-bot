# 测试与排查机器人业务

使用应用自己的构建、测试脚本。测试从 `dou-bot/testing` 导入，无需克隆框架源码。

## 离线测试一条命令

将 [命令模块](../assets/minimal-module.ts) 复制到 `src/query.module.ts`，在 `tests/application.test.ts` 中验证：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { createQueryModule } from '../src/query.module.js';
import { createTestApplication } from 'dou-bot/testing';

await test('查询命令解析参数', async (t) => {
  const bot = await createTestApplication(createQueryModule(() => true));
  t.after(() => bot.app.close());
  await bot.app.start();
  await bot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'test-message-1',
      author: { user_openid: 'test-user' },
      content: '/查询 北京 天气',
    },
  });
  assert.equal(JSON.parse(bot.messages[0]!.payload.content!).city, '北京');
  assert.equal(bot.errors.length, 0);
});
```

- 用项目的 tsc 配置编译，再执行生成的测试 JavaScript，确保参数装饰器与构造元数据参与测试。
- 工具替代 QQ 网络和框架持久化，无需真实 QQ 凭证或 PostgreSQL。
- 业务 SQL、HTTP、外部 WS 仍需通过 DI 替换；测试工具不会自动拦截任意外部请求。
- messages 检查发送目标和内容，acknowledgments 检查按钮确认，errors 检查错误。
- 用 respond 返回受控 QQ HTTP 响应，可验证发送失败。

## 按业务选择覆盖范围

- 命令：正常输入、缺参、错误选项和额外正文。
- 权限：允许与拒绝、私聊与群聊、角色缺失。
- 附件：同条附图、直接传文档、提问后补发。
- 按钮：ID、data、操作者、确认与业务结果。
- 异步流程：查询失败、取消、超时、关闭后不遗留工作。

每条新事件使用不同 ID，只在测试重复投递时复用。常用事件字段：

| 场景     | 数据                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 私聊     | C2C_MESSAGE_CREATE；d.id、d.author.user_openid、d.content                                                     |
| 群聊     | GROUP_MESSAGE_CREATE 或 GROUP_AT_MESSAGE_CREATE；另带 d.group_openid、d.author.member_openid                  |
| 群角色   | 当前消息 d.author.member_role：member/admin/owner，也覆盖缺失情况                                             |
| 群按钮   | INTERACTION_CREATE；d.id、chat_type:1、group_openid、group_member_openid、data.resolved.button_id/button_data |
| 私聊按钮 | INTERACTION_CREATE；chat_type:2、user_openid 及对应按钮数据                                                   |

## 测试多账号和追问

- 多账号用 `createMultiTestApplication(root, { bots: [{ appId: 'a' }, { appId: 'b' }] })`。
- dispatch/enqueue 的第一个参数为 appId；检查 messages 中的 appId 与 target，确保发送方正确。
- 验证同事件 ID 按账号隔离，以及停止一个账号后另一个仍工作；见 [通知测试](../assets/notifications-module.test.ts)。
- `createTestApplication` 是单账号测试视图；其中 app.client 是测试便利入口，不是生产 Application 的成员。
- 追问用 enqueue 发起 → 等问题出现在 messages → enqueue 回答 → 等 done/flush → 关闭应用。
- 不要先 await 发起命令的 dispatch，否则它还在等尚未发送的回答；见 [附件测试](../assets/attachments-module.test.ts)。

## 按症状排查

| 症状                        | 优先检查                                              |
| --------------------------- | ----------------------------------------------------- |
| 装饰器或注入失败            | 编译配置、值导入、providers/imports/exports           |
| 命令没有回复                | Controller 注册、前缀、实际事件类型、Guard 和 onError |
| 加 Slot/Option 后旧输入报错 | 正文是否需要 Rest，输入是否歧义或重复                 |
| 管理员操作被拒绝            | 当前事件是否有角色；按钮权限不能当作角色资料          |
| prompt 一直等待             | 账号、会话、用户是否一致，QQ 是否投递了回答           |
| 按钮已确认但没有结果        | OnButton ID、Guard/冷却、业务发送和 QQ 错误           |
| INVALID_STATE               | 重复等待、应用关闭或复用了已结束的上下文              |
| RESOURCE_LIMIT 或排队增长   | 请求是否迟迟未结束、等待数量与配置容量                |
| 导出或配置类型不存在        | `npm ls dou-bot`、锁文件与实际安装包声明              |

记录错误阶段、错误码和必要的 QQ trace；回复聊天用户时使用可理解的说明，不回显凭证、原始事件或堆栈。

## 验证真实收发

- 按已确定的任务范围使用应用凭证和测试会话；确认接收实例，避免替换其他正在运行的连接。
- 依次确认：用户发送/点击 → 收到事件 → 执行业务 → QQ 接口成功 → 客户端显示。
- Webhook 还需确认公网入口、平台回调和签名，保留原始正文，不跳过验签。
- 离线通过、接口成功、客户端显示分别记录；未实测的行为明确标注。
- 完成后按任务需要关闭临时实例，简要说明结果。
