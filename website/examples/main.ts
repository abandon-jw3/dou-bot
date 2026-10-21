import { NotificationsModule } from './multi-bot/app.module.ts';
import { appOptions } from './config.ts';
import { AppModule as Context } from './context/app.module.ts';
import { AppFactory } from 'dou-bot';
import { AppModule as Client } from './client/app.module.ts';
import { AppModule as Hello } from './hello/app.module.ts';
import { AppModule as Query } from './query/app.module.ts';
import { AppModule as Guards } from './guards/app.module.ts';
import { AppModule as Access } from './access/app.module.ts';
import { AppModule as Prompt } from './prompt/app.module.ts';
import { AppModule as Buttons } from './buttons/app.module.ts';
import { AppModule as Messages } from './messages/app.module.ts';
import { AppModule as Events } from './events/app.module.ts';

const modules = {
  'multi-bot': NotificationsModule,
  context: Context,
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
  throw new Error(
    '示例名应为 hello/query/context/guards/access/prompt/buttons/events/messages/client',
  );
const options = appOptions(process.env);
const app = await AppFactory.create(modules[name as keyof typeof modules], options);
const close = () => {
  app.close().catch(() => {
    console.error('关闭失败');
    process.exitCode = 1;
  });
};
process.once('SIGINT', close);
process.once('SIGTERM', close);
await app.start();
console.log(`示例 ${name} 已启动，接入方式 ${process.env.QQ_TRANSPORT ?? 'ws'}。`);
