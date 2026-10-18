import { BotManager } from '../contracts.js';
import type { BotHandle, BotStatus, QQClient } from '../contracts.js';
import { accountClient } from '../qq/facade.js';
import { addressId } from './group-routes.js';
import { FrameworkError } from './errors.js';
import type { BotRuntime } from './bot-runtime.js';

export class Manager extends BotManager {
  constructor(private readonly handles: ReadonlyMap<string, Handle>) {
    super();
  }
  override get(appId: string): BotHandle {
    addressId(appId);
    const handle = this.handles.get(appId);
    if (!handle) throw new FrameworkError('BOT_UNAVAILABLE', 'Bot account is not configured');
    return handle;
  }
  override list(): readonly BotHandle[] {
    return Object.freeze([...this.handles.values()]);
  }
}
export class Handle implements BotHandle {
  runtime: BotRuntime;
  readonly client: QQClient;
  private starting: Promise<void> | undefined;
  constructor(
    readonly appId: string,
    private readonly build: () => BotRuntime,
    private readonly resume: () => Promise<void>,
    private readonly deadline: () => number,
    private readonly lifetime: AbortSignal,
  ) {
    this.runtime = build();
    this.client = accountClient(() => this.runtime.client);
  }
  get status(): BotStatus {
    return this.runtime.status;
  }
  start(): Promise<void> {
    return this.resume();
  }
  begin(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = Promise.resolve()
      .then(async () => {
        this.lifetime.throwIfAborted();
        if (this.status === 'stopping')
          throw new FrameworkError('INVALID_STATE', 'Bot is still stopping');
        if (this.status === 'stopped' || this.status === 'failed') {
          // Failed is visible while cleanup runs. Reuse its completion before replacing shared account state.
          await this.runtime.stop(this.deadline()).catch(() => {});
          this.lifetime.throwIfAborted();
          this.runtime = this.build();
        }
        await this.runtime.start();
      })
      .finally(() => {
        this.starting = undefined;
      });
    return this.starting;
  }
  stop(): Promise<void> {
    return this.runtime.stop(this.deadline());
  }
  snapshot() {
    return this.runtime.snapshot();
  }
}
