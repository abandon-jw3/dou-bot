import { BotFactory } from 'dou-bot';
import type { BotApplication } from 'dou-bot';
import { AppModule } from './app.module.ts';

let stopping = false;

async function main(): Promise<void> {
  const appId = process.env.QQ_APP_ID;
  const secret = process.env.QQ_APP_SECRET;
  if (!appId || !secret) throw new Error('请在本地配置 QQ_APP_ID 和 QQ_APP_SECRET');
  let app: BotApplication | undefined = undefined;
  let shutdown: Promise<void> | undefined;
  const close = () => {
    stopping = true;
    if (app && !shutdown) {
      shutdown = app.close().catch(() => {
        console.error('机器人关闭失败');
        process.exitCode = 1;
      });
    }
  };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
  if (process.send) {
    // 开发脚本用 IPC 请求关闭，Windows 下也能等待 app.close() 完成。
    process.on('message', (message: unknown) => {
      if (
        typeof message === 'object' &&
        message !== null &&
        'type' in message &&
        message.type === 'dou-bot:dev-stop'
      )
        close();
    });
    process.once('disconnect', close);
    process.send({ type: 'dou-bot:dev-ready' }, () => {});
    // IPC 通道本身不应阻止已关闭的机器人退出。
    process.channel?.unref();
  }

  app = await BotFactory.create(AppModule, {
    appId,
    secret,
    transport: { type: 'ws' },
    // 参数缺失、类型错误或 Slot 歧义时，回复用法提示；前缀仍使用默认的 /。
    commands: { invalidInput: 'reply' },
  });
  if (stopping) {
    close();
    await shutdown;
    return;
  }
  await app.start();
  if (!stopping) console.log('机器人已启动：/hello 查看最小示例，/example 查看装饰器示例。');
}

main().catch((error: unknown) => {
  if (stopping) return;
  console.error(error instanceof Error ? error.message : '启动失败');
  process.exitCode = 1;
});
