import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from './attachments-module.js';

const payload = (id: string, content: string, type = 'file') => ({
  op: 0 as const,
  t: 'C2C_MESSAGE_CREATE',
  d: {
    id,
    content,
    author: { user_openid: 'user' },
    attachments: [
      { url: 'https://example.invalid/doc', filename: '报告_20261007.docx', content_type: type },
    ],
  },
});

await test('attachment starter selects same-message images and direct uploads', async () => {
  const bot = await createTestApplication(AppModule);
  await bot.app.start();
  try {
    await bot.dispatch(payload('image', '/收图', 'image/png'));
    await bot.dispatch(payload('document', ''));
    assert.deepEqual(
      bot.messages.map((m) => m.payload.content),
      ['收到 1 张图片。', '已接收：报告_20261007.docx。'],
    );
    assert.equal(bot.errors.length, 0);
  } finally {
    await bot.app.close();
  }
});

await test('attachment starter prompt owns its file input and replies to the new message', async () => {
  const bot = await createTestApplication(AppModule);
  await bot.app.start();
  try {
    const start = bot.enqueue(payload('start', '/上传 file'));
    for (let i = 0; i < 100 && bot.messages.length === 0; i++) await delay(5);
    assert.equal(bot.messages.length, 1);
    const answer = bot.enqueue(payload('answer', ''));
    assert.ok('done' in start && 'done' in answer);
    await Promise.all([start.done, answer.done]);
    assert.equal(bot.messages.length, 2);
    assert.equal(bot.messages[1]?.payload.msg_id, 'answer');
    assert.equal(bot.messages[1]?.payload.content, '收到 1 个 file 附件。');
    assert.equal(bot.errors.length, 0);
  } finally {
    await bot.app.close();
  }
});
