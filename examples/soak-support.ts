import assert from 'node:assert/strict';
import { systemClock } from '../src/core/clock.js';
import type { Clock, Timer } from '../src/core/clock.js';
import type { Application } from '../src/core/application.js';

/** Repository diagnostics only; these private resource counters are not SDK API. */
export class CountingClock implements Clock {
  readonly active = new Set<Timer>();
  maximum = 0;
  monotonic(): number {
    return systemClock.monotonic();
  }
  wallTime(): number {
    return systemClock.wallTime();
  }
  timeout(callback: () => void, milliseconds: number): Timer {
    return this.schedule(callback, milliseconds, false);
  }
  interval(callback: () => void, milliseconds: number): Timer {
    return this.schedule(callback, milliseconds, true);
  }
  private schedule(callback: () => void, milliseconds: number, repeat: boolean): Timer {
    const run = () => {
      if (!repeat) this.active.delete(timer);
      callback();
    };
    const native = repeat
      ? systemClock.interval(run, milliseconds)
      : systemClock.timeout(run, milliseconds);
    const timer = {
      cancel: () => {
        native.cancel();
        this.active.delete(timer);
      },
      unref: () => native.unref(),
    };
    this.active.add(timer);
    this.maximum = Math.max(this.maximum, this.active.size);
    return timer;
  }
}

export function inspectResources(app: Application, clock: CountingClock) {
  const size = (name: string) => {
    const value: unknown = Reflect.get(app.execution, name);
    assert.ok(value instanceof Map || value instanceof Set, `Missing internal diagnostic: ${name}`);
    return value.size;
  };
  const dispatcher: unknown = Reflect.get(app, 'dispatcher');
  assert.ok(dispatcher && typeof dispatcher === 'object');
  const cooldowns: unknown = Reflect.get(dispatcher, 'cooldowns');
  assert.ok(cooldowns && typeof cooldowns === 'object');
  const cooldownSize: unknown = Reflect.get(cooldowns, 'size');
  assert.equal(typeof cooldownSize, 'number');
  return {
    ...app.snapshot().queue,
    dedup: size('dedup'),
    replyScopes: size('scopes'),
    tasks: size('tasks'),
    signals: app.execution.managedSignals.size,
    timers: clock.active.size,
    prompts: app.snapshot().prompts.pending,
    cooldowns: cooldownSize as number,
  };
}

export function assertReleased(app: Application, clock: CountingClock): void {
  assert.equal(app.status, 'stopped');
  for (const [resource, value] of Object.entries(inspectResources(app, clock)))
    assert.equal(value, 0, `Resource retained after close: ${resource}`);
}

/** Wake blocked workload promises on interrupt/watchdog; the runner awaits close and records errors. */
export function closeOnAbort(app: Application, signal: AbortSignal): () => void {
  const close = () => {
    app.close().catch(() => {});
  };
  signal.addEventListener('abort', close, { once: true });
  if (signal.aborted) close();
  return () => signal.removeEventListener('abort', close);
}
