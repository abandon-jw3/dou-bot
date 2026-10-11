import assert from 'node:assert/strict';
import test from 'node:test';
import { createTestApplication } from 'dou-bot/testing';
import { ContextExampleModule } from './context-module.js';

for (const group of [false, true]) {
  await test(`上下文示例在${group ? '群聊' : '私聊'}准备并读取本次执行的数据`, async (t) => {
    const bot = await createTestApplication(ContextExampleModule);
    t.after(() => bot.app.close());
    await bot.app.start();
    await bot.dispatch({
      op: 0,
      t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      d: {
        id: 'context-1',
        content: '/上下文',
        ...(group
          ? { group_openid: 'group', author: { member_openid: 'user' } }
          : { author: { user_openid: 'user' } }),
      },
    });
    assert.equal(
      bot.messages[0]?.payload.content,
      `命令：上下文；会话：${group ? '群聊' : '私聊'}`,
    );
    assert.equal(bot.errors.length, 0);
  });
}
