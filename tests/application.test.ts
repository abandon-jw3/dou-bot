import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from '../src/app.module.js';

await test('私聊 /hello 使用默认称呼并自动回复', async (t) => {
  const bot = await createTestApplication(AppModule);
  t.after(() => bot.app.close());
  await bot.app.start();

  await bot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'private-message-1',
      author: { user_openid: 'test-user' },
      content: '/hello',
    },
  });

  assert.equal(bot.messages.length, 1);
  assert.deepEqual(bot.messages[0]?.target, { scene: 'private', userId: 'test-user' });
  assert.equal(bot.messages[0]?.payload.content, '你好，朋友！');
  assert.equal(bot.errors.length, 0);
});

await test('群聊 /hello 小明 绑定参数并自动回复', async (t) => {
  const bot = await createTestApplication(AppModule);
  t.after(() => bot.app.close());
  await bot.app.start();

  await bot.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'group-message-1',
      group_openid: 'test-group',
      author: { member_openid: 'test-user' },
      content: '/hello 小明',
    },
  });

  assert.equal(bot.messages.length, 1);
  assert.deepEqual(bot.messages[0]?.target, { scene: 'group', groupId: 'test-group' });
  assert.equal(bot.messages[0]?.payload.content, '你好，小明！');
  assert.equal(bot.errors.length, 0);
});
