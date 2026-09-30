import assert from 'node:assert/strict';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from './hello/app.module.js';

const bot = await createTestApplication(AppModule);
await bot.app.start();
try {
  await bot.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'demo-message', author: { user_openid: 'demo-user' }, content: '/hello 小明' },
  });
  assert.equal(bot.messages[0]?.payload.content, '你好，小明！');
  assert.equal(bot.errors.length, 0);
  console.log(bot.messages[0]?.payload.content);
} finally {
  await bot.app.close();
}
