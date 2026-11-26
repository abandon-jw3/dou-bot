import type { BotOptions } from '../src/index.js';
import type { DatabaseOptions, Type } from '../src/index.js';
import type { SingleBotOptions } from '../src/core/single-options.js';
import { Application } from '../src/core/application.js';
import type { RuntimePorts } from '../src/core/application.js';

/** Live SDK probes require their own PostgreSQL configuration and an explicitly migrated schema. */
export function exampleDatabase(): DatabaseOptions {
  const required = (name: string) => {
    const value = process.env[name];
    if (value === undefined || (!value.trim() && name !== 'DATABASE_PASSWORD'))
      throw new Error(`Configure ${name} for the live SDK example`);
    return value;
  };
  return {
    host: required('DATABASE_HOST'),
    user: required('DATABASE_USER'),
    database: required('DATABASE_NAME'),
    password: required('DATABASE_PASSWORD'),
    port: Number(process.env.DATABASE_PORT ?? 5432),
    ssl: process.env.DATABASE_SSL === 'true',
    schema: process.env.DATABASE_SCHEMA ?? 'dou_bot',
  };
}
/** Common environment wiring for repository probes; business applications use AppFactory directly. */
export async function createLiveApplication(
  root: Type,
  options: SingleBotOptions,
  ports?: RuntimePorts,
) {
  const { appId, secret, api, interactions, transport, ...shared } = options;
  const protocol = transport && { ...transport };
  const webhook =
    protocol?.type === 'webhook'
      ? {
          listen: protocol.listen ?? true,
          ...(protocol.port === undefined ? {} : { port: protocol.port }),
          ...(protocol.host === undefined ? {} : { host: protocol.host }),
        }
      : undefined;
  if (protocol?.type === 'webhook') {
    delete protocol.listen;
    delete protocol.host;
    delete protocol.port;
  }
  const config = {
    ...shared,
    database: exampleDatabase(),
    bots: [
      {
        appId,
        secret,
        ...(api ? { api } : {}),
        ...(protocol ? { transport: protocol as NonNullable<BotOptions['transport']> } : {}),
        ...(interactions ? { interactions } : {}),
      },
    ],
    ...(webhook ? { webhook } : {}),
  };
  return Application.create(root, config, ports);
}
