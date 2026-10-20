import assert from 'node:assert/strict';
import test from 'node:test';
import { Application } from '../src/core/application.js';
import { MemoryPersistence } from '../src/testing/memory-persistence.js';
import { Arg, Command, Controller, Ctx, Module } from '../src/index.js';
import type { MessageContext } from '../src/index.js';
import {
  accountFor,
  accountIds,
  comparisonProfile,
  continuationMeta,
  event,
  makeMeta,
  record,
} from '../examples/mixed-benchmark/common.js';
import { startGateway } from '../examples/mixed-benchmark/gateway.js';
import {
  applicationResources,
  assertApplicationReleased,
} from '../examples/mixed-benchmark/resources.js';
import { CountingClock } from '../examples/soak-support.js';
import { deferred, until } from './helpers.js';
import { ErrorReporter } from '../src/core/logging.js';
import { auditReports } from '../examples/mixed-benchmark/error-audit.js';

const options = {
  kind: 'comparison',
  concurrency: 8,
  outboundConcurrency: 8,
  rate: 100,
  durationMs: 1000,
} as const;

await test('benchmark error accounting survives asynchronous callbacks after event entries are released', async () => {
  const gate = deferred<void>();
  const entries = new Set(['one', 'two']);
  const order: string[] = [];
  const reporter = new ErrorReporter(
    () => ['private-fixture'],
    async (error, context) => {
      await gate.promise;
      assert.equal(entries.has(context.eventId!), false);
      assert.equal(error.message, '[redacted]');
      order.push(`callback:${context.eventId}`);
    },
    2000,
    { debug() {}, info() {}, warn() {}, error() {} },
  );
  auditReports(reporter, (_error, context) => {
    assert.equal(entries.has(context.eventId!), true);
    order.push(`audit:${context.eventId}`);
  });
  try {
    reporter.report(new Error('private-fixture'), { phase: 'command', eventId: 'one' });
    reporter.report(new Error('private-fixture'), { phase: 'command', eventId: 'two' });
    entries.clear();
    order.push('events-complete');
    assert.deepEqual(order, ['audit:one', 'audit:two', 'events-complete']);
    gate.resolve();
    await until(() => order.length === 5);
    assert.deepEqual(order, [
      'audit:one',
      'audit:two',
      'events-complete',
      'callback:one',
      'callback:two',
    ]);
  } finally {
    gate.resolve();
    reporter.close();
  }
});

await test('WS comparisons preserve workload, account ownership and explicit delivery loss', () => {
  const baseline = comparisonProfile(options);
  const ws = comparisonProfile({ ...options, transport: 'ws' });
  assert.deepEqual({ ...ws, transport: 'webhook' }, baseline);
  for (const firstBotPercent of [50, 80]) {
    const config = comparisonProfile({ ...options, transport: 'ws', bots: 2, firstBotPercent });
    let first = 0;
    for (let id = 1; id <= 10000; id++) {
      const meta = makeMeta(id, 0, 0n, config);
      const account = accountFor(meta, config);
      if (account === accountIds(config)[0]) first++;
      assert.ok(meta.groupId.endsWith(account));
      for (const correct of [true, false])
        assert.equal(accountFor(continuationMeta(meta, 1, correct, 1n), config), account);
      assert.equal(meta.kind, makeMeta(id, 0, 0n, baseline).kind);
    }
    assert.ok(Math.abs(first / 100 - firstBotPercent) < 2);
  }
  for (const extra of [
    { transport: 'tcp' },
    { bots: 3 },
    { firstBotPercent: 80 },
    { bots: 2, firstBotPercent: 0 },
    { bots: 2, firstBotPercent: 100 },
    { bots: 2, firstBotPercent: 50.5 },
  ])
    assert.throws(() => comparisonProfile({ ...options, ...extra }));
});

await test(
  'gateway uses actual SDK sockets, resumes without invented replay and isolates stop/start',
  { timeout: 12000 },
  async () => {
    const config = comparisonProfile({ ...options, transport: 'ws', bots: 2 });
    const ids = accountIds(config);
    const gateway = await startGateway(ids);
    const clock = new CountingClock();
    const received: { account: string; group: string | undefined; text: string }[] = [];
    @Controller()
    class Commands {
      @Command('echo')
      echo(@Arg(0) text: string, @Ctx() ctx: MessageContext) {
        received.push({
          account: ctx.appId,
          group: ctx.scene === 'group' ? ctx.groupId : undefined,
          text,
        });
      }
    }
    @Module({ controllers: [Commands] })
    class Root {}
    const app = await Application.create(
      Root,
      {
        database: { host: '127.0.0.1', user: 'offline', password: '', database: 'offline' },
        bots: ids.map((appId) => ({
          appId,
          secret: 'fixture-secret',
          transport: {
            type: 'ws',
            gatewayUrl: gateway.origin,
            retry: { baseDelayMs: 10, maxDelayMs: 20 },
            closeTimeoutMs: 100,
          },
        })),
        execution: { concurrency: 2 },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      },
      {
        persistence: new MemoryPersistence(),
        clock,
        fetch: () =>
          Promise.resolve(
            new Response(JSON.stringify({ access_token: 'fixture-token-1', expires_in: 3600 })),
          ),
      },
    );
    const write = (account: string, text: string) => {
      const meta = makeMeta(Number(text), 0, 0n, config);
      const payload = event({
        ...meta,
        scene: 'group',
        groupId: `${account}-group`,
        kind: 'query',
      });
      assert.ok(record(payload.d));
      payload.d.content = `/echo ${text}`;
      return gateway.write(account, payload, (error) => assert.ifError(error));
    };
    try {
      assert.equal(write(ids[0]!, '1'), 'unavailable');
      await app.start();
      assert.equal(
        gateway.write(
          ids[0]!,
          { op: 0, t: 'C2C_MESSAGE_CREATE', d: { content: 'x'.repeat(4 * 1024 * 1024) } },
          () => assert.fail('Oversized frame written'),
        ),
        'backpressure',
      );
      assert.equal(write(ids[0]!, '2'), 'writing');
      assert.equal(write(ids[1]!, '3'), 'writing');
      await until(() => received.length === 2);
      assert.deepEqual(received.map((row) => row.account).sort(), [...ids].sort());
      for (const row of received) assert.equal(row.group, `${row.account}-group`);
      gateway.reconnect(ids[0]!);
      assert.equal(write(ids[0]!, '4'), 'unavailable');
      await until(() => gateway.snapshot().accounts[ids[0]!]!.resumes === 1);
      assert.equal(write(ids[0]!, '5'), 'writing');
      await until(() => received.length === 3);
      assert.equal(
        received.some((row) => row.text === '4'),
        false,
      );
      assert.equal(gateway.snapshot().accounts[ids[0]!]!.lastResumeSequence, 2);
      await app.bots.get(ids[0]!).stop();
      await until(() => !gateway.snapshot().accounts[ids[0]!]!.ready);
      assert.equal(write(ids[0]!, '6'), 'unavailable');
      assert.equal(write(ids[1]!, '7'), 'writing');
      await until(() => received.length === 4);
      await app.bots.get(ids[0]!).start();
      assert.equal(gateway.snapshot().accounts[ids[0]!]!.identifies, 2);
      assert.equal(write(ids[0]!, '8'), 'writing');
      await until(() => received.length === 5 && gateway.drained());
      assert.equal(gateway.snapshot().errorCount, 0);
      assert.equal(applicationResources(app, clock).tasks, 0);
      assert.deepEqual(received.map((row) => row.text).sort(), ['2', '3', '5', '7', '8']);
    } finally {
      await app.close();
      assertApplicationReleased(app, clock);
      await gateway.close();
      assert.equal(gateway.snapshot().connections, 0);
    }
  },
);
