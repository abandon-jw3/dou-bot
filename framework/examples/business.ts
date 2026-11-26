import { createTestApplication } from '../src/testing/index.js';
import type { QQDispatch } from '../src/index.js';
import { createBusinessModule, demoAccess } from './business/app.module.js';

const harness = await createTestApplication(createBusinessModule(demoAccess), {
  commands: { prefix: '', invalidInput: 'reply' },
});
const inputs: QQDispatch[] = [
  {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'deny', author: { user_openid: 'visitor' }, content: '查询 北京 天气' },
  },
  {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'invalid', author: { user_openid: 'demo-private' }, content: '查询 北京' },
  },
  {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'valid', author: { user_openid: 'demo-private' }, content: '查询 今天 天气 北京 -d' },
  },
  {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'cooldown', author: { user_openid: 'demo-private' }, content: '查 北京 天气' },
  },
  {
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'group',
      group_openid: 'demo-group',
      author: { member_openid: 'demo-member' },
      content: '查询 空气质量 上海 "未来 三天"',
    },
  },
  {
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: 'button',
      chat_type: 1,
      group_openid: 'demo-group',
      group_member_openid: 'demo-member',
      data: { resolved: { button_id: 'query-weather', button_data: '上海' } },
    },
  },
  {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'help', author: { user_openid: 'demo-private' }, content: 'help 查询' },
  },
];
try {
  await harness.app.start();
  for (const [index, input] of inputs.entries()) {
    await harness.dispatch(input);
    const payload = harness.messages.at(-1)?.payload;
    console.log(
      `${index + 1}. ${payload?.msg_type === 2 ? payload.markdown.content : (payload?.content ?? '无提示')}`,
    );
  }
  console.log(`按钮确认：${harness.acknowledgments.length} 次`);
} finally {
  await harness.app.close();
}
