import type { AppOptions, BotOptions, ExecutionOptions } from '../contracts.js';
import { resolveBotOptions, resolveSharedOptions } from './config.js';
import type { AccountOptions } from './single-options.js';
import { integer, keys } from './config-validation.js';
import { FrameworkError } from './errors.js';
import { hasControlCharacters } from './utils.js';
import { databaseSettings } from '../database/postgres.js';
import { outboundSettings } from './outbound.js';
import { diagnosticsSettings } from '../diagnostics/observer.js';
export type RequiredExecution = Required<ExecutionOptions>;
export function resolveApplication(options: AppOptions) {
  keys(
    options,
    [
      'database',
      'bots',
      'commands',
      'execution',
      'outbound',
      'diagnostics',
      'context',
      'prompts',
      'webhook',
      'logger',
      'onError',
    ],
    'application',
  );
  if (!Array.isArray(options.bots) || !options.bots.length || options.bots.length > 1000)
    throw new FrameworkError('CONFIG', 'bots must be a nonempty list of at most 1000 accounts');
  const database = databaseSettings(options.database);
  const webhook = options.webhook ?? {};
  keys(webhook, ['listen', 'host', 'port'], 'webhook listener');
  if (webhook.listen !== undefined && typeof webhook.listen !== 'boolean')
    throw new FrameworkError('CONFIG', 'Invalid webhook.listen');
  if (webhook.host !== undefined && (typeof webhook.host !== 'string' || !webhook.host.trim()))
    throw new FrameworkError('CONFIG', 'Invalid webhook.host');
  const shared = resolveSharedOptions(options);
  const appIds = new Set<string>();
  const paths = new Set<string>();
  const bots = Array.from(options.bots).map((bot: BotOptions) => {
    keys(bot, ['appId', 'secret', 'transport', 'api', 'interactions'], 'bot');
    if (
      typeof bot.appId !== 'string' ||
      !bot.appId.trim() ||
      bot.appId.length > 1024 ||
      hasControlCharacters(bot.appId, true)
    )
      throw new FrameworkError('CONFIG', 'Invalid bot appId');
    let account: AccountOptions = bot;
    if (bot.transport?.type === 'webhook') {
      if (
        bot.transport.listen !== undefined ||
        bot.transport.host !== undefined ||
        bot.transport.port !== undefined
      )
        throw new FrameworkError('CONFIG', 'Configure the shared listener in application.webhook');
      account = {
        ...bot,
        transport: {
          ...bot.transport,
          listen: false,
          path: bot.transport.path ?? `/qq/${encodeURIComponent(bot.appId)}`,
        },
      };
    }
    const config = resolveBotOptions(account, shared);
    if (appIds.has(config.appId)) throw new FrameworkError('CONFIG', 'Duplicate bot appId');
    appIds.add(config.appId);
    if (config.transport.type === 'webhook') {
      if (paths.has(config.transport.path))
        throw new FrameworkError('CONFIG', 'Duplicate Webhook path');
      paths.add(config.transport.path);
    }
    return config;
  });
  return Object.freeze({
    database,
    bots: Object.freeze(bots),
    shared,
    outbound: outboundSettings(options.outbound),
    diagnostics: diagnosticsSettings(options.diagnostics),
    webhook: Object.freeze({
      listen: webhook.listen ?? true,
      host: webhook.host ?? '127.0.0.1',
      port: integer(webhook.port, 3000, 'webhook.port', 0, 65535),
    }),
  });
}
export type ApplicationSettings = ReturnType<typeof resolveApplication>;
