import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import type { GuardContext, GuardResult, QQDispatch } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
import { createQueryModule } from './minimal-module.js';

function policy(ctx: GuardContext): GuardResult {
  const allowed =
    ctx.scene === 'private'
      ? ctx.userId === 'private-user'
      : ctx.groupId === 'test-group' && ctx.userId === 'group-member';
  return allowed || { allow: false, message: '未授权' };
}
let next = 0;
function message(content: string, group = false, user?: string): QQDispatch {
  return {
    op: 0,
    t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `skill-example-${++next}`,
      content,
      ...(group
        ? {
            group_openid: 'test-group',
            author: { member_openid: user ?? 'group-member' },
          }
        : { author: { user_openid: user ?? 'private-user' } }),
    },
  };
}

await test('consumer module runs real decorators and DI with reordered slots, rest and options', async (t) => {
  const h = await createTestApplication(createQueryModule(policy), {
    commands: { prefix: '', invalidInput: 'reply' },
  });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('查询 今天 天气 北京 --page 2 -d'));
  await h.dispatch(message('查 北京 空气质量 "未来 三天"', true));
  assert.deepEqual(JSON.parse(h.messages[0]!.payload.content!) as unknown, {
    city: '北京',
    topic: '天气',
    remaining: ['今天'],
    page: 2,
    detail: true,
  });
  assert.deepEqual(JSON.parse(h.messages[1]!.payload.content!) as unknown, {
    city: '北京',
    topic: '空气质量',
    remaining: ['未来 三天'],
    page: 1,
    detail: false,
  });
  await h.dispatch(message('查询 北京 天气'));
  assert.equal(h.messages[2]!.payload.content, '请稍后再查询。');
  await h.dispatch(message('help 查'));
  assert.match(h.messages[3]!.payload.content!, /用法：查询/u);
  assert.equal(h.errors.length, 0);
});

await test('guard runs before parsing; Rest preserves input errors and invalid input does not consume cooldown', async (t) => {
  const h = await createTestApplication(createQueryModule(policy), {
    commands: { prefix: '', invalidInput: 'reply' },
  });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('查询 "未闭合', false, 'unknown-user'));
  assert.equal(h.messages[0]!.payload.content, '未授权');
  await h.dispatch(message('查询 北京 上海 天气'));
  assert.match(h.messages[1]!.payload.content!, /多个匹配值/u);
  await h.dispatch(message('查询 北京 天气 -p 0'));
  assert.match(h.messages[2]!.payload.content!, /不能小于/u);
  await h.dispatch(message('查询 天气 北京'));
  assert.deepEqual(JSON.parse(h.messages[3]!.payload.content!) as unknown, {
    city: '北京',
    topic: '天气',
    remaining: [],
    page: 1,
    detail: false,
  });
  await tick();
  assert.equal(h.errors.length, 2);
});
