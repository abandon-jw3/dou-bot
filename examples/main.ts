import { BotFactory } from 'dou-bot';
import { AppModule as Client } from './client/app.module.js';
import { AppModule as Hello } from './hello/app.module.js';
import { AppModule as Query } from './query/app.module.js';
import { AppModule as Guards } from './guards/app.module.js';
import { AppModule as Access } from './access/app.module.js';
import { AppModule as Prompt } from './prompt/app.module.js';
import { AppModule as Buttons } from './buttons/app.module.js';
import { AppModule as Messages } from './messages/app.module.js';
import { AppModule as Events } from './events/app.module.js';

const modules = {
  client: Client,
  hello: Hello,
  query: Query,
  guards: Guards,
  access: Access,
  prompt: Prompt,
  buttons: Buttons,
  events: Events,
  messages: Messages,
};
const name = process.argv[2] ?? 'hello';
if (!Object.hasOwn(modules, name))
  throw new Error('示例名应为 hello/query/guards/access/prompt/buttons/events');
const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('请配置本地 QQ_APP_ID 和 QQ_APP_SECRET');
const transport = process.env.QQ_TRANSPORT ?? 'ws';
if (transport !== 'ws' && transport !== 'webhook')
  throw new Error('QQ_TRANSPORT 应为 ws 或 webhook');

const app = await BotFactory.create(modules[name as keyof typeof modules], {
  appId,
  secret,
  transport:
    transport === 'ws'
      ? { type: 'ws' }
      : {
          type: 'webhook',
          host: '127.0.0.1',
          port: Number(process.env.PORT ?? '3000'),
          path: '/qq',
        },
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
console.log(`示例 ${name} 已启动，接入方式 ${transport}。`);
