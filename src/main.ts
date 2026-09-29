import { BotFactory, FrameworkError, QQApiError } from 'dd-bot';
import { createModule } from './app.js';
import { readConfig } from './config.js';

async function main(): Promise<void> {
  const appId = process.env.QQ_APP_ID;
  const secret = process.env.QQ_APP_SECRET;
  if (!appId || !secret) throw new Error('请在本地配置 QQ_APP_ID 和 QQ_APP_SECRET');
  const config = readConfig();
  const transport = process.env.QQ_TRANSPORT ?? 'ws';
  if (transport !== 'ws' && transport !== 'webhook')
    throw new Error('QQ_TRANSPORT 必须是 ws 或 webhook');
  const app = await BotFactory.create(
    createModule(config, { audit: (event) => console.info(JSON.stringify(event)) }),
    {
      appId,
      secret,
      commands: { prefix: config.prefix, invalidInput: 'reply' },
      transport:
        transport === 'ws'
          ? { type: 'ws' }
          : {
              type: 'webhook',
              host: '127.0.0.1',
              port: Number(process.env.PORT ?? 3000),
              path: '/qq',
            },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError: (error, context) =>
        console.error(
          JSON.stringify({
            event: 'bot-error',
            phase: context.phase,
            code: error instanceof FrameworkError ? error.code : 'ERROR',
            ...(error instanceof QQApiError ? { httpStatus: error.httpStatus } : {}),
          }),
        ),
    },
  );
  const close = () => {
    app.close().catch(() => {
      console.error('关闭未在期限内完成');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await app.start();
  console.log(JSON.stringify({ event: 'started', transport, prefix: config.prefix }));
}
main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '启动失败');
  process.exitCode = 1;
});
