import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { QQDispatch, Type } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule as Attachments } from '../examples/attachments/app.module.js';
import { AppModule as Identity } from '../examples/identity/app.module.js';

let next = 0;
function message(content: string, group: boolean, attachments: unknown[] = []): QQDispatch {
  return {
    op: 0,
    t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `docs-new-${++next}`,
      content,
      attachments,
      ...(group
        ? { group_openid: 'group', author: { member_openid: 'user', member_role: 'admin' } }
        : { author: { user_openid: 'user' } }),
    },
  };
}
const file = (type: string) => ({
  url: 'https://example.invalid/upload',
  content_type: type,
  filename: '报告_20261007.docx',
});
async function setup(t: TestContext, root: Type) {
  const bot = await createTestApplication(root, {
    commands: { invalidInput: 'reply' },
    execution: { concurrency: 1 },
  });
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}
async function until(predicate: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error('等待文档示例超时');
    await delay(5);
  }
}

for (const group of [false, true]) {
  await test(`文档附件示例 ${group ? '群聊' : '私聊'}：同条、自动上传和三种分条附件`, async (t) => {
    const bot = await setup(t, Attachments);
    await bot.dispatch(message('/收图', group, [file('image/png')]));
    assert.equal(bot.messages[0]?.payload.content, '收到 1 张图片。');
    await bot.dispatch(message('', group, [file('file')]));
    assert.equal(bot.messages[1]?.payload.content, '已接收：报告_20261007.docx。');
    for (const [kind, type] of [
      ['video', 'video/mp4'],
      ['audio', 'voice'],
      ['file', 'file'],
    ] as const) {
      const before = bot.messages.length;
      const start = bot.enqueue(message(`/上传 ${kind}`, group));
      await until(() => bot.messages.length === before + 1);
      const input = message('', group, [file(type)]);
      const answer = bot.enqueue(input);
      assert.ok('done' in start && 'done' in answer);
      await Promise.all([start.done, answer.done]);
      assert.equal(bot.messages.length, before + 2);
      assert.equal(bot.messages.at(-1)?.payload.content, `收到 1 个 ${kind} 附件。`);
      assert.equal(bot.messages.at(-1)?.payload.msg_id, (input.d as { id: string }).id);
    }
    assert.equal(bot.errors.length, 0);
  });

  await test(`文档身份示例 ${group ? '群聊' : '私聊'}：消息与当前按钮操作者`, async (t) => {
    const bot = await setup(t, Identity);
    await bot.dispatch(message('/我是谁', group));
    assert.equal(
      bot.messages[0]?.payload.content,
      `用户：user；群：${group ? 'group' : '私聊'}；角色：${group ? 'admin' : '未知或不适用'}。`,
    );
    await bot.dispatch(message('/身份按钮', group));
    await bot.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: `docs-identity-click-${next++}`,
        chat_type: group ? 1 : 2,
        ...(group
          ? { group_openid: 'group', group_member_openid: 'operator' }
          : { user_openid: 'operator' }),
        data: { resolved: { button_id: 'who', button_data: 'identity' } },
      },
    });
    assert.equal(
      bot.messages[2]?.payload.content,
      `操作者：operator；群：${group ? 'group' : '私聊'}。`,
    );
    assert.equal(bot.acknowledgments.length, 1);
    assert.equal(bot.errors.length, 0);
  });
}
