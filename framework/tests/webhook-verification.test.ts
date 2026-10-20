import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import type { TestContext } from 'node:test';
import { Command, Controller, Module } from '../src/index.js';
import type { DiagnosticsOptions, ErrorContext, WebhookTransportOptions } from '../src/index.js';
import { resolveOptions } from '../src/core/config.js';
import { SingleTestApplication as Application } from '../src/testing/single-bot.js';
import { WebhookVerifier } from '../src/transport/webhook.js';
import { FakeClock } from './fake-clock.js';
import { deferred, serve, until } from './helpers.js';

const secret = '0123456789abcdef';
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(secret.repeat(2)),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const silent = { debug() {}, info() {}, warn() {}, error() {} };

await test('native async verification preserves raw bytes, timestamps and strict signature syntax', async () => {
  const clock = new FakeClock();
  const verifier = new WebhookVerifier(secret, 1000, () => clock.wallTime());
  const timestamp = String(clock.wallTime() / 1000);
  const body = Buffer.from('{ "op":0, "d":{"content":"中文 🌧️"} }');
  const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), key).toString('hex');
  let settled = false;
  const valid = verifier.verify(timestamp, body, signature).then((result) => {
    settled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(settled, false, 'Valid crypto work must yield beyond the current microtask turn');
  assert.equal(await valid, true);
  assert.equal(await verifier.verify(timestamp, body, signature.toUpperCase()), true);
  assert.equal(
    await verifier.verify(timestamp, Buffer.concat([body, Buffer.from(' ')]), signature),
    false,
  );
  for (const value of [signature.slice(1), 'g'.repeat(128), '0'.repeat(128)])
    assert.equal(await verifier.verify(timestamp, body, value), false);
  for (const value of [
    '',
    ` ${timestamp}`,
    `${timestamp}.0`,
    '-1',
    '1725442341',
    '9999999999999999',
  ])
    assert.equal(await verifier.verify(value, body, signature), false);
  clock.jumpWall(1001);
  assert.equal(await verifier.verify(timestamp, body, signature), false);
  clock.jumpWall(-2002);
  assert.equal(await verifier.verify(timestamp, body, signature), false);
});

await test('verification timeout configuration is snapshotted, bounded and Webhook-only', () => {
  const base = { appId: 'fixture-app', secret };
  const transport: WebhookTransportOptions = { type: 'webhook', verifyTimeoutMs: 250 };
  const config = resolveOptions({ ...base, transport });
  transport.verifyTimeoutMs = 1;
  assert.equal(config.transport.type === 'webhook' && config.transport.verifyTimeoutMs, 250);
  const defaults = resolveOptions({ ...base, transport: { type: 'webhook' } });
  assert.equal(defaults.transport.type === 'webhook' && defaults.transport.verifyTimeoutMs, 10000);
  for (const value of [0, -1, 0.5, NaN, Infinity, 2147483648, '10', null]) {
    assert.throws(
      () =>
        resolveOptions({
          ...base,
          transport: { type: 'webhook', verifyTimeoutMs: value } as WebhookTransportOptions,
        }),
      { code: 'CONFIG' },
    );
  }
  assert.throws(
    () =>
      resolveOptions({
        ...base,
        transport: { type: 'ws', verifyTimeoutMs: 100 } as unknown as WebhookTransportOptions,
      }),
    { code: 'CONFIG' },
  );
});

async function pendingVerification(
  t: TestContext,
  options: Partial<WebhookTransportOptions> = {},
  diagnostics?: DiagnosticsOptions,
) {
  const clock = new FakeClock();
  const jobs: ReturnType<typeof deferred<boolean>>[] = [];
  const errors: { error: Error; context: ErrorContext }[] = [];
  let handled = 0;
  t.mock.method(WebhookVerifier.prototype, 'verify', () => {
    const job = deferred<boolean>();
    jobs.push(job);
    return job.promise;
  });
  @Controller()
  class Commands {
    @Command('verified') run(): void {
      handled++;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret,
      logger: silent,
      ...(diagnostics ? { diagnostics } : {}),
      onError(error, context) {
        errors.push({ error, context });
      },
      transport: {
        type: 'webhook',
        listen: false,
        maxConcurrentRequests: 1,
        verifyTimeoutMs: 100,
        ...options,
      },
      execution: { shutdownTimeoutMs: 200 },
    },
    {
      clock,
      fetch: () => Promise.resolve(Response.json({ access_token: 'fixture', expires_in: 7200 })),
    },
  );
  const host = await serve(app.webhookHandler());
  await app.start();
  t.after(async () => {
    for (const job of jobs) job.resolve(false);
    await app.close().catch(() => {});
    await host.close();
    await clock.flush();
    assert.equal(clock.pending, 0);
  });
  return {
    app,
    clock,
    jobs,
    errors,
    get handled() {
      return handled;
    },
    begin(id: string) {
      const body = JSON.stringify({
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id,
          content: '/verified',
          author: { user_openid: 'user' },
        },
      });
      const timestamp = String(Math.floor(clock.wallTime() / 1000));
      const completed = deferred<number | 'closed'>();
      const request = httpRequest(
        host.url + '/qq',
        {
          method: 'POST',
          headers: {
            'x-bot-appid': 'fixture-app',
            'content-length': String(Buffer.byteLength(body)),
            'x-signature-timestamp': timestamp,
            'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), key).toString('hex'),
          },
        },
        (response) => {
          response.resume();
          response.once('end', () => completed.resolve(response.statusCode ?? 0));
          response.once('error', () => completed.resolve('closed'));
        },
      );
      request.once('error', () => completed.resolve('closed'));
      request.end(body);
      return { request, completed: completed.promise };
    },
  };
}

await test('verification holds ingress permits, yields to HTTP and deduplicates out-of-order results', async (t) => {
  const f = await pendingVerification(t, { maxConcurrentRequests: 2 });
  const first = f.begin('duplicate');
  const second = f.begin('duplicate');
  await until(() => f.jobs.length === 2);
  assert.equal(f.handled, 0);
  assert.equal(await f.begin('overloaded').completed, 503);
  assert.equal(f.jobs.length, 2);
  f.jobs[1]!.resolve(true);
  f.jobs[0]!.resolve(true);
  assert.deepEqual(await Promise.all([first.completed, second.completed]), [200, 200]);
  await f.app.execution.idle();
  assert.equal(f.handled, 1);
  assert.equal(f.app.snapshot().events.duplicates, 1);
  const next = f.begin('recovered');
  await until(() => f.jobs.length === 3);
  f.jobs[2]!.resolve(true);
  assert.equal(await next.completed, 200);
  await f.app.execution.idle();
  assert.equal(f.handled, 2);
});

for (const late of ['success', 'failure'] as const) {
  await test(`verification timeout retains the native permit and ignores late ${late}`, async (t) => {
    const f = await pendingVerification(t);
    const first = f.begin('expired');
    await until(() => f.jobs.length === 1);
    await f.clock.advance(100);
    assert.equal(await first.completed, 503);
    assert.equal(await f.begin('blocked').completed, 503);
    assert.equal(f.jobs.length, 1);
    if (late === 'success') f.jobs[0]!.resolve(true);
    else f.jobs[0]!.reject(new Error('late native failure'));
    await f.clock.flush();
    const next = f.begin('new');
    await until(() => f.jobs.length === 2);
    f.jobs[1]!.resolve(true);
    assert.equal(await next.completed, 200);
    await f.app.execution.idle();
    assert.equal(f.handled, 1);
    assert.equal(f.app.snapshot().events.accepted, 1);
    assert.deepEqual(f.errors, []);
  });
}

await test('disconnect during verification cannot release capacity or execute a late message', async (t) => {
  const f = await pendingVerification(t);
  const first = f.begin('disconnected');
  await until(() => f.jobs.length === 1);
  first.request.destroy();
  assert.equal(await first.completed, 'closed');
  await until(() => f.clock.pending === 1); // Only the token refresh remains.
  assert.equal(await f.begin('blocked').completed, 503);
  f.jobs[0]!.resolve(true);
  await f.clock.flush();
  assert.equal(f.handled, 0);
  const next = f.begin('new');
  await until(() => f.jobs.length === 2);
  f.jobs[1]!.resolve(true);
  assert.equal(await next.completed, 200);
  await f.app.execution.idle();
  assert.equal(f.handled, 1);
  assert.deepEqual(f.errors, []);
});

await test('shutdown drains native verification and never admits a concurrent successful callback', async (t) => {
  const f = await pendingVerification(t);
  const first = f.begin('stopping');
  await until(() => f.jobs.length === 1);
  let stopped = false;
  const closing = f.app.close().then(() => {
    stopped = true;
  });
  // Resolve in the same turn as close, before transport cleanup gets its turn.
  f.jobs[0]!.resolve(true);
  await closing;
  assert.equal(stopped, true);
  assert.ok([503, 'closed'].includes(await first.completed));
  assert.equal(f.handled, 0);
  assert.equal(f.app.snapshot().events.accepted, 0);
  assert.deepEqual(f.errors, []);
});

await test('shutdown waits for native work that finishes before the shared deadline', async (t) => {
  const f = await pendingVerification(t);
  const first = f.begin('draining');
  await until(() => f.jobs.length === 1);
  let stopped = false;
  const closing = f.app.close().then(() => {
    stopped = true;
  });
  await f.clock.flush();
  assert.equal(stopped, false);
  assert.ok([503, 'closed'].includes(await first.completed));
  await f.clock.advance(50);
  assert.equal(stopped, false);
  f.jobs[0]!.resolve(true);
  await closing;
  assert.equal(f.handled, 0);
  assert.equal(f.app.snapshot().events.accepted, 0);
  assert.equal(f.clock.pending, 0);
});

await test('shutdown waits for outstanding native work but respects the shared shutdown deadline', async (t) => {
  const f = await pendingVerification(t);
  const first = f.begin('stuck');
  await until(() => f.jobs.length === 1);
  let stopped = false;
  const closing = f.app.close().finally(() => {
    stopped = true;
  });
  const failed = assert.rejects(closing, { code: 'SHUTDOWN_TIMEOUT' });
  await f.clock.flush();
  assert.equal(stopped, false);
  assert.ok([503, 'closed'].includes(await first.completed));
  await f.clock.advance(200);
  await failed;
  f.jobs[0]!.reject(new Error('late shutdown failure'));
  await f.clock.flush();
  assert.equal(f.handled, 0);
  assert.equal(f.app.snapshot().events.accepted, 0);
  assert.equal(f.clock.pending, 0);
});

await test('a signature that becomes stale while queued is rejected before admission', async (t) => {
  const f = await pendingVerification(t, { maxSignatureAgeMs: 1000, verifyTimeoutMs: 5000 });
  const first = f.begin('stale');
  await until(() => f.jobs.length === 1);
  await f.clock.advance(1001);
  f.jobs[0]!.resolve(true);
  assert.equal(await first.completed, 403);
  assert.equal(f.handled, 0);
  assert.deepEqual(f.errors, []);
});

await test('an asynchronous crypto error reports once and releases its permit', async (t) => {
  const f = await pendingVerification(t);
  const first = f.begin('error');
  await until(() => f.jobs.length === 1);
  f.jobs[0]!.reject(new Error('native fixture failure'));
  assert.equal(await first.completed, 500);
  await until(() => f.errors.length === 1);
  assert.equal(f.errors[0]!.context.phase, 'protocol');
  assert.equal(f.errors[0]!.context.appId, 'fixture-app');
  const next = f.begin('next');
  await until(() => f.jobs.length === 2);
  f.jobs[1]!.resolve(true);
  assert.equal(await next.completed, 200);
  await f.app.execution.idle();
  assert.equal(f.handled, 1);
  assert.equal(f.errors.length, 1);
});

await test('diagnostics keeps native verification active after its HTTP wait times out', async (t) => {
  const f = await pendingVerification(t, {}, { enabled: true, traceSampleRate: 1 });
  const first = f.begin('private-message');
  await until(() => f.jobs.length === 1);
  await f.clock.advance(100);
  assert.equal(await first.completed, 503);
  let metrics = f.app.diagnostics.snapshot().metrics;
  assert.equal(metrics.find((m) => m.stage === 'webhook.verify')!.active, 1);
  assert.equal(metrics.find((m) => m.stage === 'webhook.verify.wait')!.active, 0);
  assert.equal(metrics.find((m) => m.stage === 'webhook.verify.wait')!.outcomes.timeout, 1);
  assert.equal(metrics.find((m) => m.stage === 'webhook.request')!.outcomes.timeout, 1);
  await f.clock.advance(25);
  f.jobs[0]!.resolve(true);
  await f.clock.flush();
  metrics = f.app.diagnostics.snapshot().metrics;
  assert.equal(metrics.find((m) => m.stage === 'webhook.verify')!.totalMs, 125);
  assert.equal(metrics.find((m) => m.stage === 'webhook.verify.wait')!.totalMs, 100);
  assert.equal(f.handled, 0);
  assert.equal(f.app.diagnostics.snapshot().activeSpans, 0);
  const records = f.app.diagnostics.takeSpans().filter((s) => s.stage.startsWith('webhook.'));
  assert.equal(new Set(records.map((s) => s.traceId)).size, 1);
  assert.equal(JSON.stringify(records).includes('private-message'), false);
});
