import assert from 'node:assert/strict';
import test from 'node:test';
import { createMultiTestApplication } from 'dou-bot/testing';
import { Notifications, NotificationsModule } from '../src/notifications.module.ts';

await test('两个账号回复与后台主动发送使用完整目标，停止 A 不影响 B', async (t) => {
  const h = await createMultiTestApplication(NotificationsModule, {
    bots: [{ appId: 'a' }, { appId: 'b' }],
    diagnostics: { enabled: true, traceSampleRate: 1 },
  });
  t.after(() => h.app.close());
  await h.app.start();
  for (const appId of ['a', 'b']) {
    await h.dispatch(appId, {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'same-message-id',
        group_openid: `${appId}-group`,
        author: { member_openid: `${appId}-user` },
        content: '/account',
      },
    });
  }
  assert.deepEqual(
    h.messages.map((m) => [m.appId, m.payload.content]),
    [
      ['a', '机器人：a；会话：group'],
      ['b', '机器人：b；会话：group'],
    ],
  );
  const notifications = h.app.get(Notifications);
  await notifications.send({ appId: 'a', scene: 'group', groupId: 'a-group' }, '后台事件 A');
  await h.app.bots.get('a').stop();
  await assert.rejects(
    notifications.send({ appId: 'a', scene: 'group', groupId: 'a-group' }, '离线'),
    { code: 'BOT_UNAVAILABLE' },
  );
  await notifications.send({ appId: 'b', scene: 'group', groupId: 'b-group' }, '后台事件 B');
  assert.deepEqual(
    h.messages.slice(-2).map((m) => [m.appId, m.target, m.payload.content]),
    [
      ['a', { scene: 'group', groupId: 'a-group' }, '后台事件 A'],
      ['b', { scene: 'group', groupId: 'b-group' }, '后台事件 B'],
    ],
  );
  assert.equal(h.app.status, 'degraded');
  assert.equal(h.app.snapshot().outbound.pending, 0);
  assert.ok(h.app.diagnostics.snapshot().metrics.some((m) => m.stage === 'handler.invoke'));
  await h.app.bots.get('a').start();
  await h.dispatch('a', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'a-private', author: { user_openid: 'a-private-user' }, content: '/notify-here' },
  });
  assert.equal(h.messages.at(-1)?.appId, 'a');
  assert.equal(h.messages.at(-1)?.payload.content, '通知已送达。');
});
