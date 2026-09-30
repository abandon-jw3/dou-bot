import type {
  BotOptions,
  ExecutionOptions,
  QQApiOptions,
  RetryOptions,
  WebhookTransportOptions,
  WsTransportOptions,
} from '../contracts.js';
import { FrameworkError } from './errors.js';
import { callable, isRecord, nonempty } from './utils.js';
import { resolvePrompts } from './prompts.js';
import type { PromptSettings } from './prompts.js';

export interface ResolvedOptions {
  appId: string;
  secret: string;
  api: Readonly<Required<QQApiOptions>>;
  execution: Readonly<Required<ExecutionOptions>>;
  prompts: PromptSettings;
  prefix: string;
  invalidInput: 'report' | 'reply';
  acknowledge: 'auto' | 'manual';
  transport:
    | {
        type: 'ws';
        gatewayUrl?: string;
        intents: number;
        heartbeatSequenceField: 's' | 'd';
        connectTimeoutMs: number;
        closeTimeoutMs: number;
        retry: Required<RetryOptions>;
      }
    | {
        type: 'webhook';
        listen: boolean;
        host: string;
        port: number;
        path: string;
        maxBodyBytes: number;
        readTimeoutMs: number;
        maxConcurrentRequests: number;
        maxSignatureAgeMs: number;
      };
  logger: BotOptions['logger'];
  onError: BotOptions['onError'];
}

const executionDefaults: Required<ExecutionOptions> = {
  concurrency: 8,
  queueCapacity: 1000,
  maxEventBytes: 1048576,
  queueMaxBytes: 16777216,
  dedupMaxEntries: 10000,
  dedupTtlMs: 600000,
  replyScopeMaxEntries: 10000,
  replyScopeTtlMs: 3600000,
  maxContextOperations: 32,
  errorHandlerTimeoutMs: 1000,
  shutdownTimeoutMs: 10000,
  cooldownMaxEntries: 10000,
};

function keys(
  value: unknown,
  allowed: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new FrameworkError('CONFIG', `${label} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new FrameworkError('CONFIG', `Unknown ${label}.${key}`);
}
function integer(
  value: unknown,
  fallback: number,
  label: string,
  minimum = 1,
  maximum = 2147483647,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new FrameworkError('CONFIG', `${label} must be an integer in [${minimum}, ${maximum}]`);
  return value;
}
function boolean(value: unknown, fallback: boolean, label: string): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new FrameworkError('CONFIG', `${label} must be boolean`);
  return value;
}
function address(value: string, originOnly = false): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new FrameworkError('CONFIG', 'Invalid endpoint URL');
  }
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    (originOnly && (url.pathname !== '/' || url.search))
  )
    throw new FrameworkError('CONFIG', 'Invalid endpoint origin or credentials');
  return originOnly ? url.origin : url.href;
}

export function resolveOptions(raw: BotOptions): ResolvedOptions {
  keys(
    raw,
    [
      'appId',
      'secret',
      'api',
      'transport',
      'commands',
      'execution',
      'prompts',
      'interactions',
      'logger',
      'onError',
    ],
    'options',
  );
  nonempty(raw.appId, 'appId');
  nonempty(raw.secret, 'secret');
  const api = raw.api ?? {};
  keys(
    api,
    [
      'baseUrl',
      'tokenEndpoint',
      'sandbox',
      'requestTimeoutMs',
      'maxUploadBytes',
      'maxResponseBytes',
    ],
    'api',
  );
  const sandbox = boolean(api.sandbox, false, 'sandbox');
  const baseUrl =
    api.baseUrl ?? (sandbox ? 'https://sandbox.api.sgroup.qq.com' : 'https://api.sgroup.qq.com');
  const tokenEndpoint = api.tokenEndpoint ?? 'https://bots.qq.com/app/getAppAccessToken';
  nonempty(baseUrl, 'baseUrl');
  nonempty(tokenEndpoint, 'tokenEndpoint');
  const executionInput = raw.execution ?? {};
  keys(executionInput, Object.keys(executionDefaults), 'execution');
  const execution = { ...executionDefaults };
  for (const key of Object.keys(executionDefaults) as (keyof ExecutionOptions)[])
    execution[key] = integer(executionInput[key], executionDefaults[key], `execution.${key}`);
  if (
    execution.dedupMaxEntries < execution.concurrency + execution.queueCapacity ||
    execution.replyScopeMaxEntries < execution.concurrency + execution.queueCapacity ||
    execution.queueMaxBytes < execution.maxEventBytes
  )
    throw new FrameworkError(
      'CONFIG',
      'Execution capacities cannot reserve all active and queued tasks',
    );
  const commands = raw.commands ?? {};
  keys(commands, ['prefix', 'invalidInput'], 'commands');
  const invalidInput = commands.invalidInput === undefined ? 'report' : commands.invalidInput;
  if (invalidInput !== 'report' && invalidInput !== 'reply')
    throw new FrameworkError('CONFIG', 'commands.invalidInput must be report or reply');
  const prefix = commands.prefix === undefined ? '/' : commands.prefix;
  if (typeof prefix !== 'string')
    throw new FrameworkError('CONFIG', 'Command prefix must be a string');
  if (/\s/u.test(prefix))
    throw new FrameworkError('CONFIG', 'Command prefix cannot contain whitespace');
  const interactions = raw.interactions ?? {};
  keys(interactions, ['acknowledge'], 'interactions');
  const acknowledge = interactions.acknowledge ?? 'auto';
  if (acknowledge !== 'auto' && acknowledge !== 'manual')
    throw new FrameworkError('CONFIG', 'Invalid acknowledgment mode');
  if (
    raw.logger !== undefined &&
    (!isRecord(raw.logger) ||
      !['debug', 'info', 'warn', 'error'].every((key) =>
        callable(Reflect.get(raw.logger as object, key)),
      ))
  )
    throw new FrameworkError('CONFIG', 'Invalid logger');
  if (raw.onError !== undefined && !callable(raw.onError))
    throw new FrameworkError('CONFIG', 'onError must be a function');
  const transport = raw.transport ?? { type: 'ws' };
  let resolvedTransport: ResolvedOptions['transport'];
  if (transport.type === 'ws') {
    keys(
      transport,
      [
        'type',
        'gatewayUrl',
        'intents',
        'heartbeatSequenceField',
        'connectTimeoutMs',
        'closeTimeoutMs',
        'retry',
      ],
      'ws',
    );
    const ws: WsTransportOptions = transport;
    const retry = ws.retry ?? {};
    keys(retry, ['initialAttempts', 'baseDelayMs', 'maxDelayMs'], 'retry');
    const baseDelayMs = integer(retry.baseDelayMs, 1000, 'retry.baseDelayMs');
    const maxDelayMs = integer(retry.maxDelayMs, 30000, 'retry.maxDelayMs');
    if (maxDelayMs < baseDelayMs)
      throw new FrameworkError('CONFIG', 'Maximum retry delay is less than its base delay');
    if (ws.gatewayUrl !== undefined) {
      let gateway: URL;
      try {
        gateway = new URL(ws.gatewayUrl);
      } catch {
        throw new FrameworkError('CONFIG', 'Invalid gatewayUrl');
      }
      if (
        !['ws:', 'wss:'].includes(gateway.protocol) ||
        gateway.username ||
        gateway.password ||
        gateway.hash
      )
        throw new FrameworkError('CONFIG', 'Invalid gatewayUrl');
    }
    const heartbeatSequenceField = ws.heartbeatSequenceField ?? 's';
    if (heartbeatSequenceField !== 's' && heartbeatSequenceField !== 'd')
      throw new FrameworkError('CONFIG', 'Invalid heartbeat sequence field');
    resolvedTransport = {
      type: 'ws',
      ...(ws.gatewayUrl === undefined ? {} : { gatewayUrl: ws.gatewayUrl }),
      intents: integer(ws.intents, (1 << 25) | (1 << 26), 'intents', 0),
      heartbeatSequenceField,
      connectTimeoutMs: integer(ws.connectTimeoutMs, 15000, 'connectTimeoutMs'),
      closeTimeoutMs: integer(ws.closeTimeoutMs, 1000, 'closeTimeoutMs'),
      retry: Object.freeze({
        initialAttempts: integer(retry.initialAttempts, 6, 'initialAttempts'),
        baseDelayMs,
        maxDelayMs,
      }),
    };
  } else if (transport.type === 'webhook') {
    keys(
      transport,
      [
        'type',
        'listen',
        'host',
        'port',
        'path',
        'maxBodyBytes',
        'readTimeoutMs',
        'maxConcurrentRequests',
        'maxSignatureAgeMs',
      ],
      'webhook',
    );
    const webhook: WebhookTransportOptions = transport;
    const host = webhook.host ?? '127.0.0.1';
    const path = webhook.path ?? '/qq';
    nonempty(host, 'host');
    nonempty(path, 'path');
    if (!path.startsWith('/') || path.includes('?') || path.includes('#'))
      throw new FrameworkError('CONFIG', 'Invalid Webhook path');
    resolvedTransport = {
      type: 'webhook',
      listen: boolean(webhook.listen, true, 'listen'),
      host,
      path,
      port: integer(webhook.port, 3000, 'port', 0, 65535),
      maxBodyBytes: integer(webhook.maxBodyBytes, 1048576, 'maxBodyBytes'),
      readTimeoutMs: integer(webhook.readTimeoutMs, 10000, 'readTimeoutMs'),
      maxConcurrentRequests: integer(webhook.maxConcurrentRequests, 64, 'maxConcurrentRequests'),
      maxSignatureAgeMs: integer(webhook.maxSignatureAgeMs, 300000, 'maxSignatureAgeMs'),
    };
  } else throw new FrameworkError('CONFIG', 'Unknown transport');
  return Object.freeze({
    appId: raw.appId,
    secret: raw.secret,
    prefix,
    invalidInput,
    acknowledge,
    logger: raw.logger,
    onError: raw.onError,
    transport: Object.freeze(resolvedTransport),
    execution: Object.freeze(execution),
    prompts: resolvePrompts(raw.prompts),
    api: Object.freeze({
      sandbox,
      baseUrl: address(baseUrl, true),
      tokenEndpoint: address(tokenEndpoint),
      requestTimeoutMs: integer(api.requestTimeoutMs, 10000, 'requestTimeoutMs'),
      maxUploadBytes: integer(api.maxUploadBytes, 10485760, 'maxUploadBytes'),
      maxResponseBytes: integer(api.maxResponseBytes, 1048576, 'maxResponseBytes'),
    }),
  });
}
