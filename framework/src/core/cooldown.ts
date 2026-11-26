import type { CooldownOptions, GuardContext } from '../contracts.js';
import type { Clock, Timer } from './clock.js';
import { keys } from './config-validation.js';
import { FrameworkError } from './errors.js';

export function cooldownOptions(raw: CooldownOptions): Readonly<CooldownOptions> {
  keys(raw, ['scope', 'durationMs', 'message'], '@Cooldown');
  if (
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
  private readonly buckets = new Map<string, Map<string, number>>();
  private totalSize = 0;
  private timer: Timer | undefined;
  private closed = false;
  constructor(
    private readonly maximum: number,
    private readonly clock: Clock,
  ) {}
  get size(): number {
    return this.totalSize;
  }

  reserve(route: number, context: GuardContext, options: Readonly<CooldownOptions>): number {
    if (this.closed) throw new FrameworkError('INVALID_STATE', 'Cooldown store is closed');
    const session =
      context.target.scene === 'group' ? context.target.groupId : context.target.userId;
    const key =
      options.scope === 'command'
        ? String(route)
        : options.scope === 'session'
          ? `${route}\0${context.scene}\0${session}`
          : `${route}\0${context.scene}\0${session}\0${context.userId}`;
    const now = this.clock.monotonic();
    let bucket = this.buckets.get(context.appId);
    const expiry = bucket?.get(key);
    if (expiry !== undefined && expiry > now) return expiry - now;
    if (expiry !== undefined && bucket) {
      bucket.delete(key);
      this.totalSize--;
    }
    if (this.totalSize >= this.maximum) this.prune();
    if (this.totalSize >= this.maximum)
      throw new FrameworkError('RESOURCE_LIMIT', 'Cooldown capacity exhausted');
    bucket = this.buckets.get(context.appId);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(context.appId, bucket);
    }
    bucket.set(key, now + options.durationMs);
    this.totalSize++;
    this.timer ??= this.clock.interval(() => this.prune(), 1000);
    this.timer.unref();
    return 0;
  }
  private prune(): void {
    const now = this.clock.monotonic();
    for (const [appId, bucket] of this.buckets) {
      for (const [key, expiry] of bucket) {
        if (expiry <= now) {
          bucket.delete(key);
          this.totalSize--;
        }
      }
      if (!bucket.size) this.buckets.delete(appId);
    }
    if (!this.totalSize) {
      this.timer?.cancel();
      this.timer = undefined;
    }
  }
  resetBot(appId: string): void {
    const bucket = this.buckets.get(appId);
    if (bucket) {
      this.totalSize -= bucket.size;
      this.buckets.delete(appId);
    }
    if (!this.totalSize) {
      this.timer?.cancel();
      this.timer = undefined;
    }
  }
  close(): void {
    this.closed = true;
    this.timer?.cancel();
    this.timer = undefined;
    this.buckets.clear();
    this.totalSize = 0;
  }
}
