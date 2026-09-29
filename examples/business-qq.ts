import { BotFactory } from '../src/index.js';
import { createBusinessModule } from './business/app.module.js';

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret) throw new Error('Configure QQ_APP_ID and QQ_APP_SECRET locally.');
const ids = (input: string | undefined) =>
  (input ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
const groupId = process.env.DEMO_GROUP_ID;
const root = createBusinessModule({
  privateUsers: ids(process.env.DEMO_PRIVATE_USERS),
  groups: groupId ? [{ groupId, userIds: ids(process.env.DEMO_GROUP_USERS) }] : [],
});
const app = await BotFactory.create(root, {
  appId,
  secret,
  commands: { prefix: '', invalidInput: 'reply' },
  transport:
    process.env.QQ_TRANSPORT === 'webhook'
      ? { type: 'webhook', host: '127.0.0.1', port: Number(process.env.PORT ?? 3000), path: '/qq' }
      : { type: 'ws' },
});
const close = () => {
  app.close().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
await app.start();
