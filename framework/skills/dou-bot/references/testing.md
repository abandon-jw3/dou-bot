# 验证机器人行为与排查问题

在用户的应用中运行构建和测试，先查看 package.json 的现有命令。测试不依赖技能所在目录，也不需要另一个 SDK 项目。

## 不连接 QQ 也能测试命令

使用 dou-bot/testing 的 createTestApplication 运行应用模块。它替代 QQ 接入和默认发送，把输出保存在 messages、acknowledgments 和 errors 中。

下面假设 [项目与服务](project.md) 中的 AppModule 位于 src/app.module.ts，测试文件位于 tests/application.test.ts：

```ts
import test from 'node:test';
import assert from 'node:assert/strict';
import { AppModule } from '../src/app.module.js';
import { createTestApplication } from 'dou-bot/testing';

await test('名称命令返回业务配置', async (t) => {
  const bot = await createTestApplication(AppModule);
  t.after(() => bot.app.close());
  await bot.app.start();
  await bot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'test-message-1',
      author: { user_openid: 'test-user' },
      content: '/名称',
    },
  });
  assert.equal(bot.messages[0]?.payload.content, '查询');
  assert.equal(bot.errors.length, 0);
});
```

先用项目的 tsc 配置编译，再执行生成的测试 JavaScript，让参数装饰器和构造元数据实际参与测试。如果项目没有测试入口，可以增加 node:test 与独立的测试编译配置；测试输出目录应被 Git 忽略。

不用传真实凭证或建立 WS 连接。业务服务自己的数据库和 HTTP 请求仍需替换成测试实现，测试工具不会自动拦截任意 fetch。

## 覆盖用户实际会做的事

- 正常命令得到期望内容；缺参、错误选项或多余输入得到正确提示。
- 私聊与群聊采用各自身份和权限规则；未授权用户不能执行操作。
- 命令别名共享冷却；不同用户或群按业务要求隔离。
- 图片随命令发送、单独上传文档和 prompt 后补附件各走正确入口。
- 按钮 ID、data、操作者和业务状态匹配；检查确认收到与实际回复两个结果。
- 服务失败、用户取消和应用关闭能结束异步工作，不遗留下一次请求的状态。

每条新事件使用不同 ID，只有测试重复投递时才复用。常用字段如下：

| 场景     | 事件与数据                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| 私聊消息 | C2C_MESSAGE_CREATE；d.id、d.author.user_openid、d.content                                                          |
| 群消息   | GROUP_MESSAGE_CREATE 或 GROUP_AT_MESSAGE_CREATE；另带 d.group_openid 和 d.author.member_openid                     |
| 群角色   | 当前消息 d.author.member_role；填写 member/admin/owner，并覆盖角色缺失                                             |
| 群按钮   | INTERACTION_CREATE；d.id、chat_type:1、group_openid、group_member_openid，以及 data.resolved.button_id/button_data |
| 私聊按钮 | INTERACTION_CREATE；chat_type:2、user_openid 和对应按钮数据                                                        |

messages 用于断言发送目标和实际 payload，acknowledgments 检查按钮确认，errors 检查错误类别。可用 respond 返回受控的 QQ HTTP 响应来验证发送失败；业务服务的替身通过应用的 DI 配置提供。

多轮对话使用 enqueue：发起操作 → 等问题出现在消息记录 → enqueue 回答 → 等下一轮问题或整段流程结束。不能先 await 发起命令的 dispatch，否则它还在等测试尚未发送的回答。参考 [附件测试](../assets/attachments-module.test.ts)；所有步骤完成后再等待 done/flush 并关闭应用。

## 按症状定位

| 症状                             | 优先检查                                                                   |
| -------------------------------- | -------------------------------------------------------------------------- |
| 装饰器不能编译、构造注入失败     | 传统装饰器、emitDecoratorMetadata、运行时值导入、providers/imports/exports |
| 代码能编译但命令无回复           | Controller 注册、命令前缀、实际事件类型、Guard 与 onError                  |
| 加了 Slot 或 Option 后旧输入报错 | 额外正文是否需要 Rest，输入是否有歧义或重复                                |
| 管理员命令被拒绝                 | 当前事件是否提供角色；不要从昵称或按钮权限猜角色                           |
| prompt 一直等待                  | 是否同一用户和会话、QQ 是否投递回答、测试是否错误等待首条 dispatch         |
| 按钮有确认但没有业务结果         | OnButton 的 ID、Guard/冷却、业务是否发送结果以及 QQ 返回错误               |
| INVALID_STATE                    | 是否重复等待、应用已关闭，或在处理器结束后使用旧上下文                     |
| RESOURCE_LIMIT 或持续排队        | 待处理任务、等待会话、操作次数与配置容量，及业务请求是否迟迟不结束         |
| 导出或配置类型不存在             | npm ls dou-bot 的实际版本、该版本声明和当前项目的依赖解析                  |

记录错误阶段、错误码及必要的 QQ trace 信息。面向聊天用户给出可理解的失败说明，不把凭证、完整原始事件或内部堆栈直接回复出去。

## 在 QQ 客户端确认

任务需要真实收发时，使用该应用的凭证和已选定测试会话；已有明确授权可以延续。区分目标实例与其他正在运行的机器人，避免测试时相互替换连接。

验证链路是：用户发送或点击 → 应用收到事件 → 执行业务 → QQ 接口返回结果 → 客户端显示符合预期。离线模拟或业务 API 单独成功不能证明整个链路已通过；发送结果也不等于亲眼确认渲染。

Webhook 还要确认公网 HTTPS、平台配置与签名回调。保留原始请求体和路径，不通过跳过验签来掩盖接入问题。测试结束后按任务需要关闭临时实例，说明完成了哪些场景以及仍待验证的行为。
