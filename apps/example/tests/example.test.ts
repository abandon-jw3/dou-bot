import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { QQDispatch } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from '../src/app.module.ts';
import { ExampleService } from '../src/example/example.service.ts';

let nextId = 0;

// 使用真实 QQ 事件结构；每条新消息使用不同 ID，避免被框架当成重复投递。
function message(
  content: string,
  scene: 'private' | 'group' = 'private',
  userId = 'test-user',
  groupId = 'test-group',
): QQDispatch {
  return {
    op: 0,
    t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `example-message-${++nextId}`,
      content,
      ...(scene === 'private'
        ? { author: { user_openid: userId } }
        : { group_openid: groupId, author: { member_openid: userId } }),
    },
  };
}

function click(data: string, scene: 'private' | 'group'): QQDispatch {
  return {
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: `example-click-${++nextId}`,
      chat_type: scene === 'private' ? 2 : 1,
      ...(scene === 'private'
        ? { user_openid: 'test-user' }
        : { group_openid: 'test-group', group_member_openid: 'test-user' }),
      data: { resolved: { button_id: 'example:confirm', button_data: data } },
    },
  };
}

async function setup(t: TestContext) {
  // 仅替换 QQ 网络；真实模块、装饰器、依赖注入、参数解析和消息编码仍会运行。
  const bot = await createTestApplication(AppModule, { commands: { invalidInput: 'reply' } });
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}

await test('Module、Injectable、Inject、Controller、Command：模块装配、别名和帮助', async (t) => {
  const bot = await setup(t);
  // ExampleModule 导出了服务，所以根模块可以通过 app.get 访问同一个实例。
  assert.equal(bot.app.get(ExampleService).title, '装饰器示例');
  await bot.dispatch(message('/example'));
  await bot.dispatch(message('/示例'));
  assert.match(bot.messages[0]?.payload.content ?? '', /^装饰器示例\n/u);
  assert.equal(bot.messages[1]?.payload.content, bot.messages[0]?.payload.content);

  await bot.dispatch(message('/help example-slot'));
  assert.match(bot.messages[2]?.payload.content ?? '', /城市/u);
  assert.match(bot.messages[2]?.payload.content ?? '', /备注/u);
  assert.match(bot.messages[2]?.payload.content ?? '', /--detail/u);
  assert.equal(bot.errors.length, 0);
});

await test('Arg：必填位置参数、默认值、整数转换与范围校验', async (t) => {
  const bot = await setup(t);
  const greeting = '装饰器示例：你好，小明！';
  await bot.dispatch(message('/example-arg 小明'));
  await bot.dispatch(message('/example-arg 小明 2'));
  assert.equal(bot.messages[0]?.payload.content, greeting);
  assert.equal(bot.messages[1]?.payload.content, `${greeting}\n${greeting}`);

  for (const input of [
    '/example-arg',
    '/example-arg 小明 two',
    '/example-arg 小明 0',
    '/example-arg 小明 4',
    '/example-arg 小明 2 多余参数',
  ]) {
    await bot.dispatch(message(input));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /用法：\/example-arg/u);
  }
  assert.equal(bot.messages.length, 7);
});

await test('Args：完整分词保留选项和终止符，引号中的空格不拆分', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-args 小明 "两个 单词" --flag -- tail'));
  assert.equal(
    bot.messages[0]?.payload.content,
    '全部参数：["小明","两个 单词","--flag","--","tail"]',
  );
  assert.equal(bot.errors.length, 0);
});

await test('Option：长短选项、默认值、布尔值 false，以及错误输入', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-option'));
  assert.equal(bot.messages[0]?.payload.content, '装饰器示例：你好，朋友！');
  await bot.dispatch(message('/example-option --name=小明 --times 2 --shout'));
  assert.equal(
    bot.messages[1]?.payload.content,
    '大声说：装饰器示例：你好，小明！\n大声说：装饰器示例：你好，小明！',
  );
  await bot.dispatch(message('/example-option -n 小明 -t=2 --shout=false'));
  assert.equal(
    bot.messages[2]?.payload.content,
    '装饰器示例：你好，小明！\n装饰器示例：你好，小明！',
  );
  for (const input of [
    '/example-option --times 0',
    '/example-option --unknown',
    '/example-option --times 1 -t 2',
  ]) {
    await bot.dispatch(message(input));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /用法：\/example-option/u);
  }
  assert.equal(bot.messages.length, 6);
});

await test('Slot 和 Rest：无序匹配、剩余顺序、选项消费与空剩余', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-slot 明天 散步 北京 带伞 --detail'));
  await bot.dispatch(message('/example-slot 明天 北京 散步 带伞 -d'));
  assert.equal(
    bot.messages[0]?.payload.content,
    '城市：北京；活动：散步；剩余：明天 / 带伞；详细：是',
  );
  assert.equal(bot.messages[1]?.payload.content, bot.messages[0]?.payload.content);
  await bot.dispatch(message('/example-slot 上海 骑行'));
  assert.equal(bot.messages[2]?.payload.content, '城市：上海；活动：骑行；剩余：无');
  await bot.dispatch(message('/example-slot 北京 散步 -- --literal'));
  assert.equal(bot.messages[3]?.payload.content, '城市：北京；活动：散步；剩余：--literal');

  // Rest 不能掩盖缺参、重复 Slot 或未知选项。
  for (const input of [
    '/example-slot 散步 明天',
    '/example-slot 北京 上海 散步',
    '/example-slot 北京 北京 散步',
    '/example-slot 北京 散步 --unknown',
  ]) {
    await bot.dispatch(message(input));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /用法：\/example-slot/u);
  }
  assert.equal(bot.messages.length, 8);
});

await test('Ctx：群聊和私聊手动 reply，各自只发送一条消息', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-context'));
  await bot.dispatch(message('/example-context', 'group'));
  assert.equal(bot.messages.length, 2);
  assert.equal(bot.messages[0]?.payload.content, '当前会话：私聊。此回复来自 ctx.reply()。');
  assert.equal(bot.messages[1]?.payload.content, '当前会话：群聊。此回复来自 ctx.reply()。');
  assert.equal(bot.errors.length, 0);
});

await test('UseGuards：方法级与类级 Guard 分别放行或拒绝', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-group'));
  await bot.dispatch(message('/example-group', 'group'));
  await bot.dispatch(message('/example-private'));
  await bot.dispatch(message('/example-private', 'group'));
  assert.deepEqual(
    bot.messages.map((item) => item.payload.content),
    [
      '此示例只能在群聊中使用。',
      '方法级 Guard 已放行：当前是群聊。',
      '类级 Guard 已放行：当前是私聊。',
      '此示例只能在私聊中使用。',
    ],
  );
  assert.equal(bot.errors.length, 0);
});

await test('Cooldown：别名共享冷却，用户和会话隔离，到期后放行', async (t) => {
  // 控制 Node 的单调时钟以验证过期，不在测试里实际等待三秒。
  let now = performance.now();
  t.mock.method(performance, 'now', () => now);
  const bot = await setup(t);
  await bot.dispatch(message('/example-cooldown', 'group', 'user-a'));
  await bot.dispatch(message('/示例冷却', 'group', 'user-a'));
  await bot.dispatch(message('/example-cooldown', 'group', 'user-b'));
  await bot.dispatch(message('/example-cooldown', 'group', 'user-a', 'other-group'));
  now += 3001;
  await bot.dispatch(message('/example-cooldown', 'group', 'user-a'));
  assert.deepEqual(
    bot.messages.map((item) => item.payload.content),
    [
      '冷却示例执行成功。',
      '请等待 3 秒后再试。',
      '冷却示例执行成功。',
      '冷却示例执行成功。',
      '冷却示例执行成功。',
    ],
  );
  assert.equal(bot.errors.length, 0);
});

await test('On：观察三种消息事件，不自动回复，也不阻止正常命令', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('普通私聊'));
  await bot.dispatch(message('普通群聊', 'group'));
  await bot.dispatch({ ...message('群聊提及', 'group'), t: 'GROUP_AT_MESSAGE_CREATE' });
  assert.equal(bot.messages.length, 0);
  await bot.dispatch(message('/example-events'));
  assert.equal(bot.messages[0]?.payload.content, '消息事件数：4；最近事件：C2C_MESSAGE_CREATE');
  await bot.dispatch(message('/hello', 'group'));
  assert.equal(bot.messages[1]?.payload.content, '你好，朋友！');
  assert.equal(
    bot.app.get(ExampleService).describeEvents(),
    '消息事件数：5；最近事件：GROUP_MESSAGE_CREATE',
  );
  assert.equal(bot.errors.length, 0);
});

for (const scene of ['private', 'group'] as const) {
  await test(`OnButton 和 Ctx：${scene} 按钮编码、回调数据、确认与业务发送`, async (t) => {
    const bot = await setup(t);
    await bot.dispatch(message('/example-button', scene));
    const card = bot.messages[0]?.payload;
    assert.ok(card?.msg_type === 2);
    const callback = card.keyboard?.content.rows[0]?.buttons[0];
    assert.equal(callback?.id, 'example:confirm');
    assert.equal(callback?.render_data.label, '确认示例');
    assert.equal(callback?.render_data.visited_label, '确认示例');
    assert.equal(callback?.action.data, 'hello');

    await bot.dispatch(click(callback.action.data, scene));
    assert.equal(bot.messages[1]?.payload.content, '已收到你的按钮点击。');
    assert.deepEqual(bot.messages[1]?.target, bot.messages[0]?.target);
    // 按钮业务发送不伪造消息引用，交互 ID 只用于 ACK。
    assert.equal(bot.messages[1]?.payload.msg_id, undefined);
    assert.equal(bot.messages[1]?.payload.event_id, undefined);
    await bot.dispatch(click('unexpected-data', scene));
    assert.equal(bot.messages[2]?.payload.content, '示例按钮数据不正确。');
    assert.equal(bot.messages.length, 3);
    assert.deepEqual(
      bot.acknowledgments.map((item) => item.code),
      [0, 0],
    );
    assert.equal(bot.errors.length, 0);
  });
}
