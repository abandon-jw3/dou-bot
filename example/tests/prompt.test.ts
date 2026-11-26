import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';
import type { QQDispatch } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from '../src/app.module.ts';

let next = 0;
function message(
  content: string,
  scene: 'group' | 'private' = 'private',
  extra: Record<string, unknown> = {},
): QQDispatch {
  return {
    op: 0,
    t: scene === 'group' ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `prompt-example-${++next}`,
      content,
      ...(scene === 'group'
        ? { group_openid: 'test-group', author: { member_openid: 'test-user' } }
        : { author: { user_openid: 'test-user' } }),
      ...extra,
    },
  };
}
async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() >= deadline) throw new Error('等待示例状态超时');
    await delay(5);
  }
}
async function setup(t: TestContext) {
  // concurrency=1 验证等待输入确实释放执行槽；否则第二条消息会一直排队。
  const bot = await createTestApplication(AppModule, { execution: { concurrency: 1 } });
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}

for (const scene of ['private', 'group'] as const) {
  await test(`prompt ${scene}：两轮输入完成后正确引用最新消息`, async (t) => {
    const bot = await setup(t);
    // 先 enqueue，而不是 await dispatch；后者会等待整段对话完成。
    const root = bot.enqueue(message('/example-prompt', scene, { id: 'start' }));
    await until(() => bot.messages.length === 1 && bot.app.snapshot().queue.active === 0);
    const name = bot.enqueue(message(' 小明 ', scene, { id: 'name' }));
    // 第一轮回答的 done 也在整段对话结束后完成，所以先等下一条提问。
    await until(() => bot.messages.length === 2);
    const server = bot.enqueue(message(' 长安 ', scene, { id: 'server' }));
    assert.ok('done' in root && 'done' in name && 'done' in server);
    await Promise.all([root.done, name.done, server.done]);
    assert.equal(bot.messages[2]?.payload.content, '角色名：小明\n服务器：长安');
    assert.deepEqual(
      bot.messages.map((item) => item.payload.msg_id),
      ['start', 'name', 'server'],
    );
    assert.equal(bot.app.snapshot().prompts.pending, 0);
    assert.equal(bot.errors.length, 0);
  });
}

await test('prompt 图片：仅附件输入也会返回 received', async (t) => {
  const bot = await setup(t);
  const root = bot.enqueue(message('/example-prompt-image'));
  await until(() => bot.messages.length === 1);
  const answer = bot.enqueue(
    message('', 'private', {
      id: 'image',
      attachments: [
        {
          url: 'https://example.com/avatar.png',
          filename: 'avatar.png',
          content_type: 'image/png',
        },
      ],
    }),
  );
  assert.ok('done' in root && 'done' in answer);
  await Promise.all([root.done, answer.done]);
  assert.equal(bot.messages[1]?.payload.content, '收到图片：avatar.png');
  assert.equal(bot.messages[1]?.payload.msg_id, 'image');
  assert.equal(bot.errors.length, 0);
});

await test('prompt 取消：自定义取消词结束等待，由示例发送明确提示', async (t) => {
  const bot = await setup(t);
  const root = bot.enqueue(message('/example-prompt-timeout', 'private', { id: 'start' }));
  await until(() => bot.messages.length === 1);
  const answer = bot.enqueue(message(' cancel '));
  assert.ok('done' in root && 'done' in answer);
  await Promise.all([root.done, answer.done]);
  assert.equal(bot.messages[1]?.payload.content, '已取消输入。');
  assert.equal(bot.messages[1]?.payload.msg_id, 'start');
  assert.equal(bot.messages[1]?.payload.msg_seq, 2);
  assert.equal(bot.app.snapshot().prompts.pending, 0);
});

await test('prompt 业务校验：空角色名给出提示并释放会话', async (t) => {
  const bot = await setup(t);
  const root = bot.enqueue(message('/example-prompt'));
  await until(() => bot.messages.length === 1);
  const answer = bot.enqueue(message('   ', 'private', { id: 'empty' }));
  assert.ok('done' in root && 'done' in answer);
  await Promise.all([root.done, answer.done]);
  assert.equal(bot.messages[1]?.payload.content, '角色名不能为空，本次示例结束。');
  assert.equal(bot.messages[1]?.payload.msg_id, 'empty');
  assert.equal(bot.app.snapshot().queue.retainedBytes, 0);
  assert.equal(bot.errors.length, 0);
});
