import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { createControlWorkload } from '../examples/soak-controls.js';
import { CountingClock, assertReleased, closeOnAbort } from '../examples/soak-support.js';
import { Application } from '../src/core/application.js';
import type { QQMessagePayload } from '../src/index.js';

async function fixture(t: TestContext, corruptQuery = false) {
  const workload = createControlWorkload();
  const clock = new CountingClock();
  const errors: Error[] = [];
  const app = await Application.create(
    workload.module,
    {
      appId: 'soak-regression',
      secret: 'soak-regression-fixture',
      execution: { concurrency: 1, queueCapacity: 32, cooldownMaxEntries: 128 },
      prompts: { maxPending: 8 },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError(error, context) {
        if (!workload.report(error, context)) errors.push(error);
      },
    },
    {
      clock,
      transport: () => ({ start: async () => {}, stop: async () => {} }),
      fetch: (input, init) => {
        const path = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        ).pathname;
        if (path === '/app/getAppAccessToken')
          return Promise.resolve(
            Response.json({ access_token: 'soak-regression-token', expires_in: 7200 }),
          );
        const payload = JSON.parse(init?.body as string) as QQMessagePayload;
        if (corruptQuery && payload.content?.startsWith('{')) payload.content = 'null';
        const response = workload.respond(path, payload);
        assert.ok(response, 'Unexpected workload HTTP request');
        return Promise.resolve(response);
      },
    },
  );
  t.after(async () => {
    await app.close();
    assertReleased(app, clock);
  });
  await app.start();
  return { app, workload, clock, errors };
}

await Promise.all([
  test('sustained workload checks control order, prompt ownership and cleanup with one execution slot', async (t) => {
    const { app, workload, clock, errors } = await fixture(t);
    const signal = AbortSignal.timeout(10000);
    await workload.cycle(app, signal);
    await workload.cycle(app, signal);
    assert.equal(workload.stats.cycles, 2);
    assert.equal(workload.stats.queries, 4);
    assert.equal(workload.stats.promptReceived, 4);
    assert.equal(workload.stats.promptCancelled, 4);
    assert.equal(workload.stats.promptTimeout, 4);
    assert.equal(workload.stats.promptSendFailures, 4);
    await workload.prepareShutdown(app, signal);
    await app.close();
    await workload.verifyShutdown();
    assertReleased(app, clock);
    assert.deepEqual(errors, []);
  }),

  test('sustained workload fails when a query response violates the parameter contract', async (t) => {
    const { app, workload } = await fixture(t, true);
    await assert.rejects(workload.cycle(app, AbortSignal.timeout(10000)), {
      code: 'ERR_ASSERTION',
    });
    assert.equal(workload.stats.cycles, 0);
  }),

  test('interrupting a sustained workload wakes prompt waiters and releases owned resources', async (t) => {
    const { app, workload, clock } = await fixture(t);
    const cancellation = new AbortController();
    t.after(closeOnAbort(app, cancellation.signal));
    await workload.prepareShutdown(app, AbortSignal.timeout(10000));
    cancellation.abort(new Error('Deliberate local interrupt'));
    await app.close();
    await workload.verifyShutdown();
    assertReleased(app, clock);
  }),
]);
