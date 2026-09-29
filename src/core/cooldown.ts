import type { CooldownOptions, GuardContext } from '../contracts.js';
import type { Clock, Timer } from './clock.js';
import { FrameworkError } from './errors.js';
import { isRecord } from './utils.js';

export function cooldownOptions(raw: CooldownOptions): Readonly<CooldownOptions> {
  if (
    !isRecord(raw) ||
    Object.keys(raw).some((key) => !['scope', 'durationMs', 'message'].includes(key)) ||
    !['user', 'session', 'command'].includes(raw.scope) ||
    !Number.isSafeInteger(raw.durationMs) ||
    raw.durationMs < 1 ||
    raw.durationMs > 2147483647 ||
    (raw.message !== undefined &&
      raw.message !== false &&
      (typeof raw.message !== 'string' || !raw.message.trim()))
  )
    throw new FrameworkError('CONFIG', 'Invalid @Cooldown options');
  return Object.freeze({ ...raw });
}

/** No await between checking and reserving. Live records are never evicted to make space. */
export class CooldownStore {
  private readonly entries = new Map<string, number>();
  private timer: Timer | undefined;
  private closed = false;
  constructor(
    private readonly maximum: number,
    private readonly clock: Clock,
  ) {}
  get size(): number {
    return this.entries.size;
  }

  reserve(route: number, context: GuardContext, options: Readonly<CooldownOptions>): number {
    if (this.closed) throw new FrameworkError('INVALID_STATE', 'Cooldown store is closed');
    const session =
      context.target.scene === 'group' ? context.target.groupId : context.target.userId;
    const key = JSON.stringify(
      options.scope === 'command'
        ? [route]
        : options.scope === 'session'
          ? [route, context.scene, session]
          : [route, context.scene, session, context.userId],
    );
    const now = this.clock.monotonic();
    const expiry = this.entries.get(key);
    if (expiry !== undefined && expiry > now) return expiry - now;
    this.entries.delete(key);
    if (this.entries.size >= this.maximum) this.prune();
    if (this.entries.size >= this.maximum)
      throw new FrameworkError('RESOURCE_LIMIT', 'Cooldown capacity exhausted');
    this.entries.set(key, now + options.durationMs);
    this.timer ??= this.clock.interval(() => this.prune(), 1000);
    this.timer.unref();
    return 0;
  }
  private prune(): void {
    const now = this.clock.monotonic();
    for (const [key, expiry] of this.entries) if (expiry <= now) this.entries.delete(key);
    if (!this.entries.size) {
      this.timer?.cancel();
      this.timer = undefined;
    }
  }
  close(): void {
    this.closed = true;
    this.timer?.cancel();
    this.timer = undefined;
    this.entries.clear();
  }
}
