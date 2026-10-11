import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import type { QQDispatch } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { AppModule } from '../src/app.module.ts';

let next = 0;
function message(content: string, attachments: unknown[] = [], group = false): QQDispatch {
  return {
    op: 0,
    t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `new-api-${++next}`,
      content,
      attachments,
      ...(group
        ? {
            group_openid: 'group',
            author: { member_openid: 'user', member_role: 'admin', username: '', bot: false },
          }
        : { author: { user_openid: 'user', username: '', bot: false } }),
    },
  };
}
const file = (type: string, filename = '附件') => ({
  url: 'https://example.invalid/upload',
  filename,
  content_type: type,
});
async function setup(t: TestContext) {
  const bot = await createTestApplication(AppModule, {
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
    if (performance.now() > deadline) throw new Error('等待示例超时');
    await delay(5);
  }
}

for (const group of [false, true]) {
  await test(`附件与身份 ${group ? '群聊' : '私聊'}：同条图片、集合和快照`, async (t) => {
    const bot = await setup(t);
    await bot.dispatch(
      message(
        '/example-images 备注',
        [file('IMAGE/JPEG; charset=binary'), file('image/png')],
        group,
      ),
    );
    await bot.dispatch(message('/example-attachments', [file('file')], group));
    await bot.dispatch(message('/example-identity', [], group));
    assert.equal(bot.messages[0]?.payload.content, '收到 2 张图片；备注：备注。');
    assert.equal(bot.messages[1]?.payload.content, '当前消息有 1 个附件。');
    assert.match(bot.messages[2]?.payload.content ?? '', /用户名：""\n机器人：false/u);
    assert.match(
      bot.messages[2]?.payload.content ?? '',
      group ? /群：group\n角色：admin/u : /群：私聊\n角色：未知或不适用/u,
    );
    assert.equal(bot.errors.length, 0);
  });
  for (const [kind, contentType] of [
    ['video', 'video/mp4'],
    ['audio', 'voice'],
    ['file', 'file'],
  ]) {
    await test(`分条附件 ${group ? '群聊' : '私聊'}：${kind}`, async (t) => {
      const bot = await setup(t);
      const root = bot.enqueue(message(`/example-upload ${kind}`, [], group));
      await until(() => bot.messages.length === 1);
      const input = message('', [file(contentType!, '报告_20261007.docx')], group);
      const answer = bot.enqueue(input);
      assert.ok('done' in root && 'done' in answer);
      await Promise.all([root.done, answer.done]);
      assert.equal(bot.messages.length, 2); // prompt 独占该输入，不触发自动 DOCX 路由。
      assert.equal(bot.messages[1]?.payload.content, `收到 1 个 ${kind} 附件。`);
      assert.equal(bot.messages[1]?.payload.msg_id, (input.d as { id: string }).id);
      assert.equal(bot.errors.length, 0);
    });
  }
}

await test('自动 DOCX 上传只接收指定名称，重复投递与冷却不重复处理', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('', [file('file', '其他.docx')]));
  assert.equal(bot.messages.length, 0);
  const upload = message('', [file('file', '报告_20261007.docx')]);
  await bot.dispatch(upload);
  await bot.dispatch(upload);
  assert.equal(bot.messages.length, 1);
  assert.equal(bot.messages[0]?.payload.content, '已接收匹配文件：报告_20261007.docx。');
  await bot.dispatch(message('', [file('file', '报告_20261007.docx')]));
  assert.match(bot.messages[1]?.payload.content ?? '', /操作太频繁/u);
  assert.equal(bot.errors.length, 0);
});

await test('附件数量错误和分条类型不符提供结束提示，取消释放会话', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-images'));
  assert.match(bot.messages[0]?.payload.content ?? '', /不能少于 1/u);
  for (const cancel of [false, true]) {
    const before = bot.messages.length;
    const root = bot.enqueue(message('/example-upload file'));
    await until(() => bot.messages.length === before + 1);
    const answer = bot.enqueue(message(cancel ? '取消' : '', cancel ? [] : [file('image/png')]));
    assert.ok('done' in root && 'done' in answer);
    await Promise.all([root.done, answer.done]);
    assert.match(bot.messages.at(-1)?.payload.content ?? '', cancel ? /已取消/u : /匹配 0 个/u);
  }
  assert.equal(bot.app.snapshot().prompts.pending, 0);
  assert.equal(bot.errors.length, 1);
});

await test('身份按钮读取本次操作者，角色为未知', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-identity-button'));
  assert.equal(
    bot.messages[0]?.payload.keyboard?.content.rows[0]?.buttons[0]?.id,
    'example:identity',
  );
  await bot.dispatch({
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: 'identity-click',
      chat_type: 1,
      group_openid: 'group',
      group_member_openid: 'operator',
      data: { resolved: { button_id: 'example:identity', button_data: 'identity' } },
    },
  });
  assert.equal(
    bot.messages[1]?.payload.content,
    '操作者：operator；群：group；角色：未知或不适用。',
  );
  assert.equal(bot.acknowledgments.length, 1);
  assert.equal(bot.errors.length, 0);
});
