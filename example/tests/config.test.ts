import assert from 'node:assert/strict';
import test from 'node:test';
import { appOptions, databaseOptions } from '../src/config.ts';

const env = {
  QQ_APP_ID: 'a',
  QQ_APP_SECRET: 'fake-a',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_USER: 'fixture',
  DATABASE_NAME: 'fixture',
  DATABASE_PASSWORD: '',
};
await test('示例配置：单/双账号、统一 Webhook 入口及显式数据库', () => {
  assert.equal(appOptions(env).bots.length, 1);
  const config = appOptions({
    ...env,
    QQ_APP_ID_B: 'b',
    QQ_APP_SECRET_B: 'fake-b',
    QQ_TRANSPORT: 'webhook',
  });
  assert.deepEqual(
    config.bots.map((bot) => [bot.appId, bot.transport?.type]),
    [
      ['a', 'webhook'],
      ['b', 'webhook'],
    ],
  );
  assert.equal(config.webhook?.host, '127.0.0.1');
  assert.equal(databaseOptions(env).password, '');
  assert.throws(() => appOptions({ ...env, QQ_APP_ID_B: 'b' }));
  assert.throws(() => databaseOptions({}));
  assert.throws(() => appOptions({ ...env, QQ_TRANSPORT: 'other' }));
});
