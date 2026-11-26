import { AppFactory, migrateDatabase } from 'dou-bot';
import { AppModule } from './app.module.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || (name !== 'DATABASE_PASSWORD' && !value.trim()))
    throw new Error(`请配置 ${name}`);
  return value;
}
const database = {
  host: required('DATABASE_HOST'),
  port: Number(process.env.DATABASE_PORT ?? '5432'),
  user: required('DATABASE_USER'),
  database: required('DATABASE_NAME'),
  password: required('DATABASE_PASSWORD'),
};

if (process.argv.includes('--init-database')) {
  await migrateDatabase(database);
} else {
  const app = await AppFactory.create(AppModule, {
    database,
    bots: [{ appId: required('QQ_APP_ID'), secret: required('QQ_APP_SECRET') }],
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
}
