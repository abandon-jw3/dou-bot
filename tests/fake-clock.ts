import { setImmediate as tick } from 'node:timers/promises';
import type { Clock, Timer } from '../src/core/clock.js';

interface Scheduled {
  at: number;
  callback: () => void;
  interval: number | undefined;
}

/** Advance application time without waiting for real TTLs or patching global timers. */
export class FakeClock implements Clock {
  private elapsed = 0;
  private epoch = 1_790_683_200_000;
  private nextId = 0;
  private readonly scheduled = new Map<number, Scheduled>();
  monotonic(): number {
    return this.elapsed;
  }
  wallTime(): number {
    return this.epoch;
  }
  get pending(): number {
    return this.scheduled.size;
  }
  jumpWall(delta: number): void {
    this.epoch += delta;
  }
  timeout(callback: () => void, delay: number): Timer {
    return this.add(callback, delay);
  }
  interval(callback: () => void, delay: number): Timer {
    return this.add(callback, delay, delay);
  }
  private add(callback: () => void, delay: number, interval?: number): Timer {
    const id = this.nextId++;
    const milliseconds = Math.max(1, Math.min(2147483647, Math.trunc(delay)));
    this.scheduled.set(id, {
      at: this.elapsed + milliseconds,
      callback,
      interval: interval === undefined ? undefined : milliseconds,
    });
    return {
      cancel: () => {
        this.scheduled.delete(id);
      },
      unref() {},
    };
  }
  async flush(): Promise<void> {
    await tick();
  }
  async advance(milliseconds: number): Promise<void> {
    if (!Number.isFinite(milliseconds) || milliseconds < 0)
      throw new Error('Invalid fake duration');
    const target = this.elapsed + milliseconds;
    await this.flush();
    let count = 0;
    while (true) {
      const next = [...this.scheduled].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next || next[1].at > target) break;
      if (++count > 10000) throw new Error('Runaway fake timer loop');
      const [id, task] = next;
      this.epoch += task.at - this.elapsed;
      this.elapsed = task.at;
      if (task.interval === undefined) this.scheduled.delete(id);
      else task.at += task.interval;
      task.callback();
      await this.flush();
    }
    this.epoch += target - this.elapsed;
    this.elapsed = target;
    await this.flush();
  }
}
