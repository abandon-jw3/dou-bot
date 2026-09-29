import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from 'dd-bot';
import { CLOCK } from '../config.js';
import { actorKey } from '../access.js';
import type { Actor } from '../access.js';
import type { Day, Unit } from './service.js';

export interface WeatherQuery {
  readonly city: string;
  readonly day: Day;
  readonly unit: Unit;
  readonly detail: boolean;
  readonly note: string;
}

@Injectable()
export class WeatherButtons {
  private readonly entries = new Map<
    string,
    { until: number; actor: string; query: WeatherQuery }
  >();
  constructor(@Inject(CLOCK) private readonly now: () => number) {}
  issue(actor: Actor, query: WeatherQuery): string {
    for (const [key, entry] of this.entries)
      if (entry.until <= this.now()) this.entries.delete(key);
    if (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value!);
    const id = randomBytes(12).toString('hex');
    this.entries.set(id, {
      until: this.now() + 600000,
      actor: actorKey(actor),
      query: Object.freeze({ ...query }),
    });
    return id;
  }
  resolve(id: string, actor: Actor): WeatherQuery | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (entry.until <= this.now()) {
      this.entries.delete(id);
      return undefined;
    }
    return entry.actor === actorKey(actor) ? entry.query : undefined;
  }
  onModuleDestroy(): void {
    this.entries.clear();
  }
}
