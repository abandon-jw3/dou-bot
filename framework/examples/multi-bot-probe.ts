import { createHash } from 'node:crypto';
import {
  Arg,
  Command,
  Controller,
  Ctx,
  GroupRoutes,
  Inject,
  Injectable,
  MessageSender,
  Module,
  FrameworkError,
  QQApiError,
} from '../src/index.js';
import type {
  AppOptions,
  BotTarget,
  DatabaseOptions,
  GroupTarget,
  MessageContext,
  SendResult,
} from '../src/index.js';

export type ProbeAccount = 'A' | 'B';
export type ProbeRecord = Readonly<Record<string, unknown>>;
export interface ProbeSettings {
  readonly accounts: Readonly<Record<ProbeAccount, string>>;
  readonly nonce: string;
  readonly record: (event: ProbeRecord) => void;
}
const SETTINGS = Symbol('multi-bot-probe-settings');

/** Read only the supplied file values: never fall back to TEST_DATABASE_* or another project's environment. */
export function probeDatabase(
  values: Readonly<Record<string, string | undefined>>,
): DatabaseOptions {
  const required = (name: string, empty = false): string => {
    const value = values[name];
    if (value === undefined || (!empty && !value.trim()) || value.startsWith('your-'))
      throw new Error(`Fill ${name} in framework/.env`);
    return value;
  };
  const ssl = values.DATABASE_SSL ?? 'false';
  if (!['true', 'false'].includes(ssl)) throw new Error('DATABASE_SSL must be true or false');
  const port = Number(values.DATABASE_PORT ?? 5432);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('Invalid DATABASE_PORT');
  return {
    host: required('DATABASE_HOST'),
    user: required('DATABASE_USER'),
    database: required('DATABASE_NAME'),
    password: required('DATABASE_PASSWORD', true),
    schema: required('DATABASE_SCHEMA'),
    port,
    ssl: ssl === 'true',
    max: 4,
    connectionTimeoutMs: 5000,
    statementTimeoutMs: 5000,
  };
}

export function probeOptions(values: Readonly<Record<string, string | undefined>>): {
  options: AppOptions;
  accounts: Readonly<Record<ProbeAccount, string>>;
  timeoutMs: number;
} {
  const account = (alias: ProbeAccount) => {
    const appId = values[`QQ_APP_ID_${alias}`];
    const secret = values[`QQ_APP_SECRET_${alias}`];
    if (
      !appId?.trim() ||
      !secret?.trim() ||
      appId.startsWith('your-') ||
      secret.startsWith('your-')
    )
      throw new Error(`Fill QQ_APP_ID_${alias} and QQ_APP_SECRET_${alias} in framework/.env`);
    return { appId, secret, transport: { type: 'ws' as const, retry: { initialAttempts: 1 } } };
  };
  const a = account('A'),
    b = account('B');
  if (a.appId === b.appId) throw new Error('Use two different bot AppIDs');
  const timeoutMs = Number(values.PROBE_TIMEOUT_MS ?? 900000);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 60000 || timeoutMs > 3600000)
    throw new Error('PROBE_TIMEOUT_MS must be between 60000 and 3600000');
  return {
    options: {
      database: probeDatabase(values),
      bots: [a, b],
      execution: { shutdownTimeoutMs: 5000 },
    },
    accounts: Object.freeze({ A: a.appId, B: b.appId }),
    timeoutMs,
  };
}

/** Only safe classifications enter probe reports; no error message, payload, OpenID or credentials. */
export function probeError(error: unknown): ProbeRecord {
  return {
    code: error instanceof FrameworkError ? error.code : 'PROBE_ERROR',
    ...(error instanceof QQApiError
      ? {
          httpStatus: error.httpStatus,
          qqCode: typeof error.qqCode === 'number' ? error.qqCode : undefined,
        }
      : {}),
  };
}

interface Pin {
  target: BotTarget;
  userId: string;
  replySent: boolean;
}
@Injectable()
export class MultiBotProbe {
  private readonly pins = new Map<string, Pin>();
  constructor(
    @Inject(SETTINGS) private readonly settings: ProbeSettings,
    private readonly sender: MessageSender,
    private readonly routes: GroupRoutes,
  ) {}
  alias(appId: string): ProbeAccount {
    if (appId === this.settings.accounts.A) return 'A';
    if (appId === this.settings.accounts.B) return 'B';
    throw new Error('Unknown probe account');
  }
  claim(ctx: MessageContext, nonce: string | undefined): boolean {
    if (nonce !== this.settings.nonce) return false;
    const key = `${this.alias(ctx.appId)}:${ctx.scene}`;
    const previous = this.pins.get(key);
    if (previous)
      return (
        previous.userId === ctx.userId &&
        JSON.stringify(previous.target) === JSON.stringify(ctx.target)
      );
    this.pins.set(key, {
      target: Object.freeze({ ...ctx.target }),
      userId: ctx.userId,
      replySent: false,
    });
    return true;
  }
  replyResult(ctx: MessageContext, status: SendResult['status']): void {
    if (status === 'sent') this.pins.get(`${this.alias(ctx.appId)}:${ctx.scene}`)!.replySent = true;
    this.settings.record({
      event: 'reply-result',
      status,
      account: this.alias(ctx.appId),
      scene: ctx.scene,
    });
  }
  private groups(): readonly GroupTarget[] {
    return (['A', 'B'] as const).map((alias) => {
      const pin = this.pins.get(`${alias}:group`);
      if (!pin?.replySent || pin.target.scene !== 'group')
        throw new Error('Confirm a group reply from each bot first');
      return pin.target;
    });
  }
  snapshot(): ProbeRecord {
    const groups = [...this.pins.values()].filter(
      (pin) => pin.replySent && pin.target.scene === 'group',
    );
    return {
      receivers: [...this.pins.values()].map((pin) => ({
        account: this.alias(pin.target.appId),
        scene: pin.target.scene,
        replySent: pin.replySent,
        addressHash: createHash('sha256')
          .update(this.settings.nonce + JSON.stringify(pin.target))
          .digest('hex')
          .slice(0, 12),
      })),
      ...(groups.length === 2
        ? {
            distinctGroupOpenIds:
              (groups[0]!.target as GroupTarget).groupId !==
              (groups[1]!.target as GroupTarget).groupId,
          }
        : {}),
    };
  }
  async verifyRoutes(): Promise<void> {
    for (const target of this.groups()) {
      try {
        const resolved = await this.routes.resolve(target.groupId);
        this.settings.record({
          event: 'route-check',
          account: this.alias(target.appId),
          matches: resolved.appId === target.appId,
        });
      } catch (error) {
        this.settings.record({
          event: 'route-check',
          account: this.alias(target.appId),
          matches: false,
          ...probeError(error),
        });
      }
    }
  }
  async pushGroups(sequence: number): Promise<void> {
    await Promise.all(
      this.groups().map(async (target) => {
        const account = this.alias(target.appId);
        try {
          const result = await this.sender.sendMessage(
            target,
            `双机主动发送 ${this.settings.nonce}：${account} / ${sequence}`,
          );
          this.settings.record({
            event: 'external-ws-send',
            account,
            sequence,
            status: result.status,
          });
        } catch (error) {
          this.settings.record({
            event: 'external-ws-send',
            account,
            sequence,
            status: 'failed',
            ...probeError(error),
          });
        }
      }),
    );
  }
}

@Controller()
class ProbeCommands {
  constructor(private readonly probe: MultiBotProbe) {}
  @Command('多机验收')
  async ping(@Arg(0) nonce: string | undefined, @Ctx() ctx: MessageContext): Promise<void> {
    if (!this.probe.claim(ctx, nonce)) return;
    const result = await ctx.reply(
      `双机验收 ${nonce!}：${this.probe.alias(ctx.appId)} / ${ctx.scene}`,
    );
    this.probe.replyResult(ctx, result.status);
  }
}

export function multiBotProbeModule(settings: ProbeSettings) {
  @Module({
    providers: [{ provide: SETTINGS, useValue: settings }, MultiBotProbe],
    controllers: [ProbeCommands],
  })
  class ProbeModule {}
  return ProbeModule;
}
