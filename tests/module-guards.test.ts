import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { QQDispatch } from 'dd-bot';
import { createTestApplication } from 'dd-bot/testing';
import { AppModule } from '../src/app.module.js';

let next = 0;
function message(content: string, scene: 'group' | 'private', role?: string): QQDispatch {
  return {
    op: 0,
    t: scene === 'group' ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    d: {
      id: `module-example-${++next}`,
      content,
      ...(scene === 'group'
        ? {
            group_openid: 'test-group',
            author: {
              member_openid: 'test-user',
              ...(role === undefined ? {} : { member_role: role }),
            },
          }
        : { author: { user_openid: 'test-user' } }),
    },
  };
}
async function setup(t: TestContext) {
  const bot = await createTestApplication(AppModule);
  t.after(() => bot.app.close());
  await bot.app.start();
  return bot;
}

await test('模块级规则覆盖该模块两个控制器中的全部命令', async (t) => {
  const bot = await setup(t);
  for (const command of [
    'example-module-info',
    'example-module-settings',
    'example-module-owner',
  ]) {
    await bot.dispatch(message(`/${command}`, 'private'));
    assert.equal(bot.messages.at(-1)?.payload.content, '模块级检查：请在群聊中使用。');
  }
  await bot.dispatch(message('/example-module-info', 'group', 'member'));
  assert.equal(bot.messages[3]?.payload.content, '模块级检查通过：当前群成员可以查看模块信息。');
  assert.equal(bot.errors.length, 0);
});

await test('模块、类、方法按顺序收紧权限，类级规则不影响另一个控制器', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/example-module-settings', 'group', 'member'));
  await bot.dispatch(message('/example-module-settings', 'group', 'admin'));
  await bot.dispatch(message('/example-module-owner', 'group', 'admin'));
  await bot.dispatch(message('/example-module-owner', 'group', 'owner'));
  await bot.dispatch(message('/example-module-owner', 'group'));
  assert.deepEqual(
    bot.messages.map((m) => m.payload.content),
    [
      '类级检查：仅群主或管理员可用。',
      '模块和类级检查通过：可以查看管理设置。',
      '方法级检查：仅群主可用。',
      '模块、类和方法级检查全部通过。',
      '类级检查：仅群主或管理员可用。',
    ],
  );
  assert.equal(bot.errors.length, 0);
});

await test('功能模块的 Guard 不传播到主模块、父模块或帮助模块', async (t) => {
  const bot = await setup(t);
  await bot.dispatch(message('/hello', 'private'));
  await bot.dispatch(message('/example', 'private'));
  await bot.dispatch(message('/help example-module-owner', 'private'));
  assert.equal(bot.messages[0]?.payload.content, '你好，朋友！');
  assert.match(bot.messages[1]?.payload.content ?? '', /装饰器示例/u);
  assert.match(bot.messages[2]?.payload.content ?? '', /用法：\/example-module-owner/u);
  assert.equal(bot.errors.length, 0);
});
