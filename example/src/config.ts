import type { AppOptions, BotOptions, DatabaseOptions } from 'dou-bot';

export function databaseOptions(env: NodeJS.ProcessEnv): DatabaseOptions {
  const required = (name: string): string => {
    const value = env[name];
    if (value === undefined || (name !== 'DATABASE_PASSWORD' && !value.trim()))
      throw new Error(`请配置 ${name}`);
    return value;
  };
  return {
    host: required('DATABASE_HOST'),
    user: required('DATABASE_USER'),
    database: required('DATABASE_NAME'),
    password: required('DATABASE_PASSWORD'),
    port: Number(env.DATABASE_PORT ?? '5432'),
  };
}

export function appOptions(env: NodeJS.ProcessEnv): AppOptions {
  const transport = env.QQ_TRANSPORT ?? 'ws';
  if (transport !== 'ws' && transport !== 'webhook')
    throw new Error('QQ_TRANSPORT 应为 ws 或 webhook');
  const bot = (appId: string | undefined, secret: string | undefined): BotOptions => {
    if (!appId?.trim() || !secret?.trim()) throw new Error('请完整配置机器人的 AppID 和 Secret');
    return { appId, secret, transport: { type: transport } };
  };
  return {
    database: databaseOptions(env),
    bots: [
      bot(env.QQ_APP_ID, env.QQ_APP_SECRET),
      ...(env.QQ_APP_ID_B || env.QQ_APP_SECRET_B
        ? [bot(env.QQ_APP_ID_B, env.QQ_APP_SECRET_B)]
        : []),
    ],
    ...(transport === 'webhook'
      ? { webhook: { host: '127.0.0.1', port: Number(env.PORT ?? '3000') } }
      : {}),
    commands: { invalidInput: 'reply' },
    diagnostics: { enabled: true },
  };
}
