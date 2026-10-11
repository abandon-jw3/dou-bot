import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestApplication } from '../src/testing/index.js';
import { createBusinessModule, demoAccess } from '../examples/business/app.module.js';

await test('complete business module combines City, permission DI, slots, options, cooldown, help and callback buttons', async (t) => {
  const h = await createTestApplication(createBusinessModule(demoAccess), {
    commands: { prefix: '', invalidInput: 'reply' },
  });
  t.after(() => h.app.close());
  await h.app.start();
  let next = 0;
  const send = (content: string, user = 'demo-private') =>
    h.dispatch({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: `business-${++next}`, author: { user_openid: user }, content },
    });
  await send('查询 北京 天气', 'visitor');
  assert.match(h.messages[0]!.payload.content!, /没有查询权限/u);
  await send('查询 北京');
  assert.match(h.messages[1]!.payload.content!, /缺少必填参数/u);
  await send('查询 今天 天气 北京 -d');
  const result = h.messages[2]!.payload;
  assert.equal(result.msg_type, 2);
  assert.ok(result.msg_type === 2);
  assert.match(result.markdown.content, /演示数据，非实时/u);
  assert.match(result.markdown.content, /北京 天气/u);
  assert.match(result.markdown.content, /补充内容：今天/u);
  assert.match(result.markdown.content, /来源：/u);
  assert.equal(result.keyboard?.content?.rows[0]?.buttons[0]?.id, 'query-weather');
  await send('查 天气 北京');
  assert.match(h.messages[3]!.payload.content!, /操作太频繁/u);
  await h.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'business-group',
      group_openid: 'demo-group',
      author: { member_openid: 'demo-member' },
      content: '查询 空气质量 上海 "未来 三天"',
    },
  });
  assert.equal(h.messages[4]!.target.scene, 'group');
  assert.equal(h.messages[4]!.payload.msg_type, 2);
  for (const [index, user] of ['visitor', 'demo-member', 'demo-member'].entries())
    await h.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: `business-button-${index}`,
        chat_type: 1,
        group_openid: 'demo-group',
        group_member_openid: user,
        data: { resolved: { button_id: 'query-weather', button_data: '上海' } },
      },
    });
  assert.match(h.messages[5]!.payload.content!, /没有查询权限/u);
  assert.match(h.messages[6]!.payload.content!, /上海 天气/u);
  assert.match(h.messages[7]!.payload.content!, /刷新太快/u);
  assert.equal(h.acknowledgments.length, 3);
  await send('帮助 查');
  assert.match(h.messages[8]!.payload.content!, /用法：查询/u);
  assert.equal(h.errors.length, 1);
});
