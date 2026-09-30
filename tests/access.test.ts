import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import type { QQDispatch } from 'dd-bot';
import { createTestApplication } from 'dd-bot/testing';
import { AppModule } from '../src/app.module.js';

let next = 0;
function message(
  content: string,
  scene: 'group' | 'private',
  role?: string,
  user = 'test-user',
): QQDispatch {
  return {
    op: 0,
    t: scene === 'group' ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `access-example-${++next}`,
      content,
      ...(scene === 'group'
        ? {
            group_openid: 'test-group',
            author: { member_openid: user, ...(role === undefined ? {} : { member_role: role }) },
          }
        : { author: { user_openid: user } }),
    },
  };
}
async function setup(t: TestContext) {
  const bot = await createTestApplication(AppModule);
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}

await test('内置场景装饰器限制群聊和私聊', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-group-only', 'group'));
  await bot.dispatch(message('/example-group-only', 'private'));
  await bot.dispatch(message('/example-private-only', 'private'));
  await bot.dispatch(message('/example-private-only', 'group'));
  assert.deepEqual(
    bot.messages.map((m) => m.payload.content),
    [
      'GroupOnly 已放行：当前是群聊。',
      '此操作仅限群聊。',
      'PrivateOnly 已放行：当前是私聊。',
      '此操作仅限私聊。',
    ],
  );
  assert.equal(bot.errors.length, 0);
});

await test('群主及管理者示例依据当前事件角色，不对缺失角色放行', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-owner', 'group', 'owner'));
  assert.equal(bot.messages[0]?.payload.content, 'GroupRoles 已放行：当前角色是 owner。');
  await bot.dispatch(message('/example-owner', 'group', 'admin'));
  assert.match(bot.messages[1]?.payload.content ?? '', /身份不符合要求或无法确认/u);
  for (const role of ['owner', 'admin', 'member', undefined]) {
    await bot.dispatch(message('/example-managers', 'group', role));
    assert.equal(
      bot.messages.at(-1)?.payload.content,
      role === 'owner' || role === 'admin'
        ? 'GroupManagersOnly 已放行：你是群主或管理员。'
        : '此示例仅限群主或管理员。',
    );
  }
  assert.equal(bot.errors.length, 0);
});

await test('UsersOnly 示例必须匹配配置的私聊 OpenID', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-users', 'private'));
  assert.match(bot.messages[0]?.payload.content ?? '', /配置你的私聊 OpenID/u);
  await bot.dispatch(
    message('/example-users', 'private', undefined, 'replace-with-your-private-openid'),
  );
  assert.equal(bot.messages[1]?.payload.content, 'UsersOnly 已放行：你在指定用户名单中。');
  await bot.dispatch(
    message('/example-users', 'group', 'owner', 'replace-with-your-private-openid'),
  );
  assert.equal(bot.messages[2]?.payload.content, '此操作仅限私聊。');
});

await test('管理者按钮示例正确编码原生权限，并处理无角色字段的群按钮回调', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-manager-button', 'group', 'member'));
  assert.equal(bot.messages[0]?.payload.content, '此操作仅限群主或管理员。');
  await bot.dispatch(message('/example-manager-button', 'group', 'admin'));
  const payload = bot.messages[1]?.payload;
  assert.ok(payload?.msg_type === 2);
  const button = payload.keyboard?.content.rows[0]?.buttons[0];
  assert.deepEqual(button?.action.permission, { type: 1 });
  assert.equal(button?.render_data.visited_label, '管理者确认');
  await bot.dispatch({
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: 'manager-click',
      chat_type: 1,
      group_openid: 'test-group',
      group_member_openid: 'test-admin',
      data: { resolved: { button_id: 'example:managers', button_data: 'confirm' } },
    },
  });
  // 离线测试验证编码与回调；实际是否允许点击由 QQ 判断，需另做平台实测。
  assert.equal(bot.messages[2]?.payload.content, '管理者按钮点击已处理。');
  assert.equal(bot.acknowledgments.length, 1);
  assert.equal(bot.errors.length, 0);
});
