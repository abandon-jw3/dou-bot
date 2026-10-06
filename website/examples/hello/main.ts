import { BotFactory } from 'dou-bot';
import { AppModule } from './app.module.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('请配置 QQ_APP_ID 和 QQ_APP_SECRET');

const app = await BotFactory.create(AppModule, {
  appId,
  secret,
  transport: { type: 'ws' },
  commands: { prefix: '/', invalidInput: 'reply' },
});
const close = () => {
  app.close().catch(() => {
    console.error('关闭失败');
    process.exitCode = 1;
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
await app.start();
console.log('机器人已启动。');
