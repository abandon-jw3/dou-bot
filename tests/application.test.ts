import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApplication } from 'dd-bot/testing';
import type { QQDispatch } from 'dd-bot';
import { createModule } from '../src/app.js';
import type { AuditEvent } from '../src/config.js';
import { readConfig } from '../src/config.js';
import { WeatherButtons } from '../src/weather/buttons.js';
import { fixtureFetch, testConfig } from './fixtures.js';

let next = 0;
const message = (content: string, user = 'private-user', group?: string): QQDispatch => ({
  op: 0,
  t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
  d: {
    id: `test-${++next}`,
    content,
    ...(group
      ? { group_openid: group, author: { member_openid: user } }
      : { author: { user_openid: user } }),
  },
});
const click = (data: string, user = 'private-user', group?: string): QQDispatch => ({
  op: 0,
  t: 'INTERACTION_CREATE',
  d: {
    id: `click-${++next}`,
    chat_type: group ? 1 : 2,
    ...(group ? { group_openid: group, group_member_openid: user } : { user_openid: user }),
    data: { resolved: { button_id: 'weather:refresh', button_data: data } },
  },
});

await test('installed SDK drives DI, unordered City/Slot arguments, Rest notes, options, help, guards and cooldown', async (t) => {
  const calls: URL[] = [];
  const events: AuditEvent[] = [];
  const h = await createTestApplication(
    createModule(testConfig, { fetch: fixtureFetch(calls), audit: (event) => events.push(event) }),
    { commands: { prefix: '', invalidInput: 'reply' } },
  );
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('查询 北京 天气', 'outsider'));
  assert.match(h.messages[0]!.payload.content!, /尚未获准/u);
  assert.equal(calls.length, 0);
  await h.dispatch(message('查询 北京'));
  assert.match(h.messages[1]!.payload.content!, /缺少必填参数/u);
  await h.dispatch(message('查询 通勤 天气 北京 明天 --detail --unit=f'));
  const result = h.messages[2]!.payload;
  assert.ok(result.msg_type === 2);
  assert.match(result.markdown.content, /北京 · 明天天气/u);
  assert.match(result.markdown.content, /备注：通勤/u);
  assert.match(result.markdown.content, /°F/u);
  assert.match(result.markdown.content, /Open-Meteo/u);
  assert.doesNotMatch(result.markdown.content, /当前估算/u);
  await h.dispatch(message('查 北京 天气'));
  assert.match(h.messages[3]!.payload.content!, /操作太频繁/u);
  assert.equal(calls.length, 2);
  await h.dispatch(message('查询 今天 北京 天气', 'group-user', 'test-group'));
  const group = h.messages[4]!.payload;
  assert.ok(group.msg_type === 2);
  assert.match(group.markdown.content, /当前估算/u);
  await h.dispatch(message('帮助 查询'));
  assert.match(h.messages[5]!.payload.content!, /--unit/u);
  assert.equal(events.filter((event) => event.event === 'query-reply').length, 2);
});

await test('refresh performs a new request, is restricted to the original caller/session, and acknowledges every click', async (t) => {
  const calls: URL[] = [];
  const h = await createTestApplication(
    createModule(
      { ...testConfig, privateUsers: ['private-user', 'other-user'] },
      { fetch: fixtureFetch(calls) },
    ),
    { commands: { prefix: '' } },
  );
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('查询 北京 天气'));
  const card = h.messages[0]!.payload;
  assert.ok(card.msg_type === 2);
  const token = card.keyboard?.content?.rows[0]?.buttons[0]?.action.data;
  assert.ok(token);
  assert.equal(token.length, 24);
  await h.dispatch(click(token, 'other-user'));
  assert.equal(calls.length, 2);
  assert.match(h.messages[1]!.payload.content!, /不是由你/u);
  await h.dispatch(click(token));
  assert.equal(calls.length, 3);
  assert.equal(h.messages[2]!.payload.msg_type, 2);
  await h.dispatch(click(token));
  assert.equal(calls.length, 3);
  assert.match(h.messages[3]!.payload.content!, /操作太频繁/u);
  assert.equal(h.acknowledgments.length, 3);
  assert.equal(h.errors.length, 0);
});

await test('weather errors produce a friendly reply and never claim a successful live forecast', async (t) => {
  const h = await createTestApplication(
    createModule(testConfig, {
      fetch: () => Promise.resolve(new Response('private provider failure', { status: 500 })),
    }),
    { commands: { prefix: '' } },
  );
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('查询 北京 天气'));
  assert.equal(h.messages[0]!.payload.msg_type, 0);
  assert.match(h.messages[0]!.payload.content, /暂时不可用/u);
  assert.doesNotMatch(h.messages[0]!.payload.content, /private provider failure/u);
});

await test('test enrollment binds only one caller per scene, requires a random prefix, and normal mode has no enrollment route', async (t) => {
  assert.throws(() => createModule({ ...testConfig, liveEnrollment: true }), /random test prefix/u);
  const config = { ...testConfig, liveEnrollment: true, prefix: '试用-abcd1234:' };
  const h = await createTestApplication(createModule(config, { fetch: fixtureFetch() }), {
    commands: { prefix: config.prefix },
  });
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message(`${config.prefix}查询 北京 天气`));
  assert.match(h.messages[0]!.payload.content!, /尚未获准/u);
  await h.dispatch(message(`${config.prefix}启用`));
  await h.dispatch(message(`${config.prefix}启用`, 'other'));
  assert.match(h.messages[1]!.payload.content!, /已启用/u);
  assert.match(h.messages[2]!.payload.content!, /已经绑定/u);
  await h.dispatch(message(`${config.prefix}查询 北京 天气`));
  assert.equal(h.messages[3]!.payload.msg_type, 2);
  const normal = await createTestApplication(createModule(testConfig, { fetch: fixtureFetch() }), {
    commands: { prefix: '' },
  });
  t.after(() => normal.app.close());
  await normal.app.start();
  assert.equal(await normal.dispatch(message('启用')), 'ignored');
});

await test('button records expire and remain bounded; application config is fail-closed by default', () => {
  let now = 0;
  const buttons = new WeatherButtons(() => now);
  const actor = { userId: 'u', target: { scene: 'private' as const, userId: 'u' } };
  const query = { city: '北京', day: '今天' as const, unit: 'c' as const, detail: false, note: '' };
  const first = buttons.issue(actor, query);
  assert.deepEqual(buttons.resolve(first, actor), query);
  for (let i = 0; i < 256; i++) buttons.issue(actor, query);
  assert.equal(buttons.resolve(first, actor), undefined);
  const active = buttons.issue(actor, query);
  now = 600000;
  assert.equal(buttons.resolve(active, actor), undefined);
  assert.deepEqual(readConfig({}).privateUsers, []);
  assert.deepEqual(readConfig({}).groups, []);
  assert.throws(() => readConfig({ COMMAND_PREFIX: 'bad prefix' }), /不能包含空白/u);
});
