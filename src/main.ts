import { BotFactory } from 'dou-bot';
import { AppModule } from './app.module.js';

async function main(): Promise<void> {
  const appId = process.env.QQ_APP_ID;
  const secret = process.env.QQ_APP_SECRET;
  if (!appId || !secret) throw new Error('请在本地配置 QQ_APP_ID 和 QQ_APP_SECRET');
  const app = await BotFactory.create(AppModule, {
    appId,
    secret,
    transport: { type: 'ws' },
    // 参数缺失、类型错误或 Slot 歧义时，回复用法提示；前缀仍使用默认的 /。
    commands: { invalidInput: 'reply' },
  });
  const close = () => {
    app.close().catch(() => {
      console.error('机器人关闭失败');
      process.exitCode = 1;
    });
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  await app.start();
  console.log('机器人已启动：/hello 查看最小示例，/example 查看装饰器示例。');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : '启动失败');
  process.exitCode = 1;
});
