import assert from 'node:assert/strict';
import type { Application } from '../../src/core/application.js';
import { assertReleased, inspectResources } from '../soak-support.js';
import type { CountingClock } from '../soak-support.js';

/** Sum account-local state, counting shared timers and cooldowns exactly once. */
export function applicationResources(app: Application, clock: CountingClock) {
  const rows = app.config.bots.map(({ appId }) => {
    const runtime = app.runtime(appId);
    return inspectResources(
      {
        execution: runtime.execution,
        dispatcher: app.dispatcher,
        snapshot: () => runtime.snapshot(),
      },
      clock,
    );
  });
  const total = { ...rows[0]! };
  for (const row of rows.slice(1))
    for (const key of Object.keys(total) as (keyof typeof total)[])
      if (key !== 'timers' && key !== 'cooldowns') total[key] += row[key];
  const pool = app.incoming.snapshot();
  assert.equal(total.active, pool.active);
  assert.equal(total.pending, pool.pending);
  assert.equal(total.retainedBytes, pool.retainedBytes);
  return total;
}

export function assertApplicationReleased(app: Application, clock: CountingClock): void {
  for (const { appId } of app.config.bots) {
    const runtime = app.runtime(appId);
    assertReleased(
      {
        execution: runtime.execution,
        dispatcher: app.dispatcher,
        snapshot: () => runtime.snapshot(),
        status: runtime.status,
      },
      clock,
    );
  }
  for (const value of Object.values(applicationResources(app, clock))) assert.equal(value, 0);
}
