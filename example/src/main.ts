import { AppFactory } from 'dou-bot';
import type { Application } from 'dou-bot';
import { appOptions } from './config.ts';
import { AppModule } from './app.module.ts';

let stopping = false;

async function main(): Promise<void> {
  const options = appOptions(process.env);
  let app: Application | undefined = undefined;
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

  app = await AppFactory.create(AppModule, options);
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
