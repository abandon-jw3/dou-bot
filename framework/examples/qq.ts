import { exampleDatabase } from './live-application.js';
import { AppFactory, Arg, Command, Controller, Module } from '../src/index.js';

@Controller()
class Commands {
  @Command('hello')
  hello(@Arg(0) name = '朋友'): string {
    return `你好，${name}！`;
  }
}
@Module({ controllers: [Commands] })
class AppModule {}

const appId = process.env.QQ_APP_ID;
const secret = process.env.QQ_APP_SECRET;
if (!appId || !secret)
  throw new Error('Set QQ_APP_ID and QQ_APP_SECRET before running this example.');
const app = await AppFactory.create(AppModule, {
  database: exampleDatabase(),
  bots: [
    {
      appId,
      secret,
      transport: process.env.QQ_TRANSPORT === 'webhook' ? { type: 'webhook' } : { type: 'ws' },
    },
  ],
  webhook: { port: Number(process.env.PORT ?? 3000) },
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
