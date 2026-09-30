import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { Module } from 'dou-bot';
import { AppModule as Messages } from '../examples/messages/app.module.js';
import { AppModule as Client } from '../examples/client/app.module.js';
import { PulseService } from '../examples/lifecycle/resource.service.js';
import type { QQDispatch, Type, GroupRole } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule as Hello } from '../examples/hello/app.module.js';
import { AppModule as Query } from '../examples/query/app.module.js';
import { AppModule as Guards } from '../examples/guards/app.module.js';
import { AppModule as Access } from '../examples/access/app.module.js';
import { AppModule as Prompt } from '../examples/prompt/app.module.js';
import { AppModule as Buttons } from '../examples/buttons/app.module.js';
import { AppModule as Events } from '../examples/events/app.module.js';
import { setTimeout as delay } from 'node:timers/promises';

let sequence = 0;
function message(
  content: string,
  scene: 'private' | 'group' = 'private',
  user = 'USER_OPENID',
  role?: GroupRole,
): QQDispatch {
  const id = `docs-test-${++sequence}`;
  return scene === 'private'
    ? { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { user_openid: user }, content } }
    : {
        op: 0,
        t: 'GROUP_MESSAGE_CREATE',
        d: {
          id,
          group_openid: 'GROUP_OPENID',
          author: { member_openid: user, ...(role ? { member_role: role } : {}) },
          content,
        },
      };
}
async function setup(t: TestContext, module: Type, prefix = '/') {
  const bot = await createTestApplication(module, {
    commands: { prefix, invalidInput: 'reply' },
    prompts: { timeoutMs: 100, maxTimeoutMs: 5000 },
  });
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}
async function until(predicate: () => boolean) {
  const end = performance.now() + 3000;
  while (!predicate()) {
    if (performance.now() > end) throw new Error('没有观察到预期的发送记录');
    await delay(1);
  }
}
await Promise.all([
  test('消息：文本、图片上传、Markdown 和手动回复', async (t) => {
    const bot = await setup(t, Messages);
    for (const input of ['/text', '/image', '/markdown', '/manual'])
      await bot.dispatch(message(input));
    assert.deepEqual(
      bot.messages.map((m) => m.payload.msg_type),
      [0, 7, 2, 0],
    );
    assert.equal(bot.messages[3]?.payload.content, '这条消息由 ctx.reply 发送。');
    assert.equal(bot.errors.length, 0);
  }),
  test('内置客户端：可注入 QQClient 和 QQApi', async (t) => {
    const bot = await setup(t, Client);
    await bot.dispatch(message('/bot-info'));
    assert.equal(
      bot.messages[0]?.payload.content,
      '高层客户端：offline-bot；底层 API：offline-bot',
    );
    assert.equal(bot.errors.length, 0);
  }),
  test('生命周期：初始化和关闭释放示例定时器', async (t) => {
    @Module({ providers: [PulseService] })
    class Root {}
    const bot = await setup(t, Root);
    const service = bot.app.get(PulseService);
    assert.equal(service.running, true);
    await bot.app.close();
    assert.equal(service.running, false);
  }),
  test('hello：真实 DI、默认参数、别名与帮助', async (t) => {
    const bot = await setup(t, Hello);
    for (const text of ['/hello', '/hi 小明', '/help hello']) await bot.dispatch(message(text));
    assert.deepEqual(
      bot.messages.slice(0, 2).map((m) => m.payload.content),
      ['你好，朋友！', '你好，小明！'],
    );
    assert.match(bot.messages[2]?.payload.content ?? '', /hello/);
    assert.equal(bot.errors.length, 0);
  }),
  test('参数：换序、Rest、短选项、布尔值和错误输入', async (t) => {
    const bot = await setup(t, Query);
    for (const text of [
      '/查询 今天 天气 北京 带伞 -p 2 -d',
      '/查询 今天 北京 天气 带伞 --page=2 --detail=true',
    ])
      await bot.dispatch(message(text));
    const expected = {
      city: '北京',
      topic: '天气',
      notes: ['今天', '带伞'],
      page: 2,
      detail: true,
    };
    assert.deepEqual(JSON.parse(bot.messages[0]!.payload.content!), expected);
    assert.deepEqual(JSON.parse(bot.messages[1]!.payload.content!), expected);
    await bot.dispatch(message('/查询 北京 上海 天气'));
    assert.equal(bot.errors.length, 1);
    await bot.dispatch(message('/查询 北京'));
    assert.equal(bot.errors.length, 2);
    await bot.dispatch(message('/echo a "b c" --flag'));
    assert.deepEqual(JSON.parse(bot.messages.at(-1)!.payload.content!), ['a', 'b c', '--flag']);
    await bot.dispatch(message('/repeat hi 2'));
    assert.equal(bot.messages.at(-1)?.payload.content, 'hi hi');
  }),
  test('参数：空前缀仍按完整命令名匹配', async (t) => {
    const bot = await setup(t, Query, '');
    await bot.dispatch(message('查询 天气 北京'));
    assert.equal(JSON.parse(bot.messages[0]!.payload.content!).city, '北京');
    await bot.dispatch(message('随便说 查询 天气 北京'));
    assert.equal(bot.messages.length, 1);
  }),
  test('Guard：模块、类、方法顺序与别名冷却', async (t) => {
    const bot = await setup(t, Guards);
    await bot.dispatch(message('/info'));
    assert.equal(bot.messages.at(-1)?.payload.content, '请在群聊中使用。');
    await bot.dispatch(message('/info', 'group', 'OTHER_USER'));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /模块级/);
    await bot.dispatch(message('/settings', 'group', 'OTHER_USER'));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /允许名单/);
    await bot.dispatch(message('/settings', 'group'));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /类级/);
    await bot.dispatch(message('/change', 'group', 'USER_OPENID', 'member'));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /群主/);
    await bot.dispatch(message('/change', 'group', 'USER_OPENID', 'owner'));
    assert.match(bot.messages.at(-1)?.payload.content ?? '', /三级/);
    for (const command of ['/limited', '/limited-alias'])
      await bot.dispatch(message(command, 'group'));
    assert.deepEqual(
      bot.messages.slice(-2).map((m) => m.payload.content),
      ['本次允许调用。', '请稍后再试。'],
    );
  }),
  test('访问限制：场景、OpenID 与缺失角色拒绝', async (t) => {
    const bot = await setup(t, Access);
    await bot.dispatch(message('/group'));
    assert.notEqual(bot.messages.at(-1)?.payload.content, '群聊允许。');
    await bot.dispatch(message('/group', 'group'));
    assert.equal(bot.messages.at(-1)?.payload.content, '群聊允许。');
    await bot.dispatch(message('/private'));
    assert.equal(bot.messages.at(-1)?.payload.content, '私聊允许。');
    await bot.dispatch(message('/allowed', 'private', 'OTHER_USER'));
    assert.notEqual(bot.messages.at(-1)?.payload.content, '允许名单验证通过。');
    await bot.dispatch(message('/allowed'));
    assert.equal(bot.messages.at(-1)?.payload.content, '允许名单验证通过。');
    await bot.dispatch(message('/managers', 'group'));
    assert.notEqual(bot.messages.at(-1)?.payload.content, '当前发送者是群主或管理员。');
    await bot.dispatch(message('/managers', 'group', 'USER_OPENID', 'admin'));
    assert.equal(bot.messages.at(-1)?.payload.content, '当前发送者是群主或管理员。');
  }),
  ...(['private', 'group'] as const).map((scene) =>
    test(`prompt：${scene} 两轮回答引用最新消息`, async (t) => {
      const bot = await setup(t, Prompt);
      const start = bot.enqueue(message('/报名', scene));
      await until(() => bot.messages.length === 1);
      const first = bot.enqueue(message('小明', scene));
      await until(() => bot.messages.length === 2);
      const answer = message('测试服务器', scene);
      const second = bot.enqueue(answer);
      assert.ok('done' in start && 'done' in first && 'done' in second);
      await Promise.all([start.done, first.done, second.done]);
      assert.equal(bot.messages[2]?.payload.content, '已记录：小明 / 测试服务器');
      assert.equal(bot.messages[2]?.payload.msg_id, (answer.d as { id: string }).id);
      assert.equal(bot.errors.length, 0);
    }),
  ),
  test('prompt：取消与配置超时', async (t) => {
    const bot = await setup(t, Prompt);
    const start = bot.enqueue(message('/报名'));
    await until(() => bot.messages.length === 1);
    const cancel = bot.enqueue(message('取消'));
    assert.ok('done' in start && 'done' in cancel);
    await Promise.all([start.done, cancel.done]);
    assert.equal(bot.messages.at(-1)?.payload.content, '已取消。');
    await bot.dispatch(message('/报名'));
    assert.equal(bot.messages.at(-1)?.payload.content, '等待超时。');
  }),
  ...(['private', 'group'] as const).map((scene) =>
    test(`按钮：${scene} 编码、确认和业务回复`, async (t) => {
      const bot = await setup(t, Buttons);
      await bot.dispatch(message('/menu', scene));
      const payload = bot.messages[0]!.payload;
      assert.equal(payload.msg_type, 2);
      const first = payload.keyboard?.content?.rows[0]?.buttons[0];
      assert.equal(first?.render_data.label, '确认');
      assert.equal(first?.render_data.visited_label, '确认');
      await bot.dispatch({
        op: 0,
        t: 'INTERACTION_CREATE',
        d: {
          id: `click-${++sequence}`,
          chat_type: scene === 'group' ? 1 : 2,
          ...(scene === 'group'
            ? { group_openid: 'GROUP_OPENID', group_member_openid: 'USER_OPENID' }
            : { user_openid: 'USER_OPENID' }),
          data: { resolved: { button_id: 'docs:confirm', button_data: 'confirm' } },
        },
      });
      assert.equal(bot.acknowledgments.length, 1);
      assert.equal(bot.acknowledgments[0]?.code, 0);
      assert.equal(bot.messages.at(-1)?.payload.content, '确认成功。');
      assert.equal(bot.messages.at(-1)?.payload.msg_id, undefined);
    }),
  ),
  test('On 观察器独立执行并返回 void', async (t) => {
    const bot = await setup(t, Events);
    await bot.dispatch(message('/events'));
    assert.equal(bot.messages[0]?.payload.content, '观察到 1 条消息事件。');
    await bot.dispatch(message('/events', 'group'));
    assert.equal(bot.messages[1]?.payload.content, '观察到 2 条消息事件。');
  }),
]);
