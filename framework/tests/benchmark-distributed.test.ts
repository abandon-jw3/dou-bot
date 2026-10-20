import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Agent, createServer, request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { finished } from 'node:stream/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import test from 'node:test';
import {
  comparisonProfile,
  continuationMeta,
  eventId,
  makeMeta,
  plannedMeta,
  profile,
} from '../examples/mixed-benchmark/common.js';
import { startFixture } from '../examples/mixed-benchmark/fixture.js';
import { receiveFrames, sendFrame } from '../examples/mixed-benchmark/frames.js';
import { Mailbox } from '../examples/mixed-benchmark/worker.js';
import { RemoteSession } from '../examples/mixed-benchmark/remote-session.js';
import {
  createDriverAgent,
  driverIdleSocketTimeoutMs,
} from '../examples/mixed-benchmark/driver.js';

await test('concurrency comparisons preserve one workload and reject unbounded or unknown options', () => {
  const options = {
    kind: 'comparison',
    concurrency: 32,
    outboundConcurrency: 8,
    rate: 500,
    durationMs: 120000,
  };
  const base = comparisonProfile(options);
  assert.equal(base.diagnostics, 'off');
  for (const diagnostics of ['metrics', 'sampled'] as const)
    assert.deepEqual(comparisonProfile({ ...options, diagnostics }), { ...base, diagnostics });
  assert.equal(
    comparisonProfile({ ...options, kind: 'smoke' }).driverMaxInFlight,
    base.driverMaxInFlight,
  );
  for (const [concurrency, outboundConcurrency] of [
    [32, 16],
    [64, 16],
    [64, 32],
  ]) {
    assert.deepEqual(comparisonProfile({ ...options, concurrency, outboundConcurrency }), {
      ...base,
      concurrency,
      outboundConcurrency,
    });
  }
  for (const change of [
    { kind: 'unknown' },
    { concurrency: 0 },
    { outboundConcurrency: 1.1 },
    { rate: NaN },
    { durationMs: 1000000 },
    { rate: 2500, durationMs: 120000 },
    { extra: true },
    { diagnostics: 'all' },
  ]) {
    assert.throws(() => comparisonProfile({ ...options, ...change }));
  }
});

await test('remote fixtures reconstruct primary and continuation identities without sharing host clocks', () => {
  const config = comparisonProfile({
    kind: 'comparison',
    concurrency: 32,
    outboundConcurrency: 16,
    rate: 500,
    durationMs: 120000,
  });
  const ids = new Set<number>();
  for (let id = 1; id <= 10000; id++) {
    const phase = id <= 2000 ? 0 : 1;
    const root = makeMeta(id, phase, 123n, config);
    assert.deepEqual({ ...plannedMeta(id, config), dueNs: '123' }, root);
    if (root.kind !== 'prompt') continue;
    for (const step of [1, 2])
      for (const correct of [true, false]) {
        const answer = continuationMeta(root, step, correct, 999n);
        assert.equal(ids.has(answer.id), false);
        ids.add(answer.id);
        assert.deepEqual({ ...plannedMeta(answer.id, config), dueNs: '999' }, answer);
      }
  }
  const total = 65000;
  assert.equal(plannedMeta(total + 1, config)?.kind, 'shutdown-prompt');
  assert.equal(plannedMeta(total + 9, config)?.kind, 'hold');
  for (const id of [-1, 0, NaN, 2_000_000, total + 49])
    assert.equal(plannedMeta(id, config), undefined);
  assert.throws(() => continuationMeta(makeMeta(1, 0, 1n, config), 3, true, 1n));
});

await test('framed control handles split UTF-8 and bounds malformed, oversized and truncated input', async () => {
  const stream = new PassThrough();
  const received: unknown[] = [],
    errors: Error[] = [];
  const detach = receiveFrames(
    stream,
    (value) => received.push(value),
    (error) => errors.push(error),
  );
  const content = Buffer.from(
    JSON.stringify({ role: 'sdk', message: { type: 'ready', text: '中文' } }) + '\n',
  );
  for (let i = 0; i < content.length; i += 2) stream.write(content.subarray(i, i + 2));
  stream.end();
  await finished(stream);
  detach();
  assert.deepEqual(received, [{ role: 'sdk', message: { type: 'ready', text: '中文' } }]);
  assert.equal(errors.length, 0);
  for (const value of ['[1]\n', '{bad}\n', 'x'.repeat(65536), '{"type":"partial"']) {
    const input = new PassThrough();
    const failures: Error[] = [];
    receiveFrames(
      input,
      () => assert.fail('Invalid frame was accepted'),
      (error) => failures.push(error),
    );
    input.end(value);
    await finished(input);
    assert.equal(failures.length, 1);
  }
  const output = new PassThrough();
  assert.throws(() => sendFrame(output, { oversized: 'x'.repeat(65536) }));
  output.destroy();
});

await test('control mailboxes preserve a completed notice when worker exit arrives before its consumer', async () => {
  const box = new Mailbox();
  box.deliver({ type: 'final', reportPath: 'fixture.json' });
  const error = new Error('worker exited');
  const pending = box.wait('snapshot');
  const rejected = assert.rejects(pending, (value: unknown) => value === error);
  box.fail(error);
  await rejected;
  assert.equal((await box.wait('final')).reportPath, 'fixture.json');
  await assert.rejects(box.wait('missing'), (value: unknown) => value === error);
  const crowded = new Mailbox();
  for (let i = 0; i < 129; i++) crowded.deliver({ type: 'unconsumed', i });
  await assert.rejects(crowded.wait('missing'), /overflow/u);
});

await test(
  'remote session exit does not wait for stdout retained by a descendant',
  { timeout: 5000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dou-worker-exit-'));
    const entry = join(directory, 'worker.mjs');
    await writeFile(
      entry,
      `import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 10000)'], { stdio: ['ignore', 'inherit', 'inherit'] });
child.once('spawn', () => process.stdout.write(JSON.stringify({ role: 'control', message: { type: 'host-ready', descendant: child.pid } }) + '\\n', () => process.exit(0)));
`,
    );
    const session = await RemoteSession.create({
      directory: process.cwd(),
      node: process.execPath,
      entry,
      label: `exit-${randomBytes(4).toString('hex')}`,
      token: 'fixture',
      runtimeSeconds: 10,
    });
    let descendant: number | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      descendant = Number((await session.control.wait('host-ready', 2000)).descendant);
      assert.ok(Number.isSafeInteger(descendant) && descendant > 0);
      await Promise.race([
        session.exited,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Exit was blocked by a retained stdout descriptor')),
            2000,
          );
        }),
      ]);
      assert.equal(session.exitCode, 0);
    } finally {
      if (timer) clearTimeout(timer);
      if (descendant) {
        try {
          process.kill(descendant, 'SIGTERM');
        } catch {
          /* The owned child may already have exited. */
        }
      }
      await session.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

await test('extracted fixture rejects cross-group replies and reused sequences, then cancels delayed work', async () => {
  const config = profile('smoke');
  let id = 1;
  while (makeMeta(id, 0, 0n, config).scene !== 'group') id++;
  const meta = makeMeta(id, 0, 0n, config);
  const fixture = await startFixture(config, {
    plan: (value) => (value === id ? meta : undefined),
    phaseOf: () => 0,
    question() {},
  });
  const body = { msg_id: eventId(meta), msg_seq: 1, content: 'result' };
  const request = (group: string) =>
    fetch(`${fixture.origin}/v2/groups/${group}/messages`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  try {
    const first = await request(meta.groupId);
    assert.equal(first.status, 200);
    await first.text();
    const wrong = await request('wrong-group');
    assert.equal(wrong.status, 500);
    await wrong.text();
    const duplicate = await request(meta.groupId);
    assert.equal(duplicate.status, 500);
    await duplicate.text();
    const pending = fetch(`${fixture.origin}/data?id=1&phase=0&user=u&kind=hold`).catch(
      () => undefined,
    );
    const deadline = performance.now() + 2000;
    while (fixture.activity().fixtureActive === 0 && performance.now() < deadline) await sleep(5);
    assert.equal(fixture.activity().fixtureActive, 1);
    const closing = fixture.close();
    assert.equal(fixture.close(), closing);
    const result = await closing;
    await pending;
    assert.equal(result.counts.unexpected, 2);
    assert.deepEqual(result.cleanup, { fixtureActive: 0, tokenActive: 0, responseTimers: 0 });
  } finally {
    await fixture.close();
  }
});

await test(
  'driver retires idle sockets before server expiry without shortening active requests',
  { timeout: 12000 },
  async () => {
    const baseline = new Agent({ keepAlive: true, maxSockets: 1 });
    const agent = createDriverAgent(1);
    let connections = 0;
    const server = createServer((req, res) => {
      if (req.url === '/slow') setTimeout(() => res.end('ok'), driverIdleSocketTimeoutMs + 200);
      else res.end('ok');
    });
    server.keepAliveTimeout = 5000;
    server.on('connection', () => connections++);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const send = (pool: Agent, path: string) =>
      new Promise<boolean>((resolve, reject) => {
        const req = request(`http://127.0.0.1:${address.port}${path}`, { agent: pool }, (res) => {
          res.resume();
          res.once('end', () => resolve(req.reusedSocket));
          res.once('error', reject);
        });
        req.setTimeout(10000, () => req.destroy(new Error('Active request timed out')));
        req.once('error', reject);
        req.end();
      });
    const free = (pool: Agent) =>
      Object.values(pool.freeSockets).reduce((sum, sockets) => sum + (sockets?.length ?? 0), 0);
    try {
      // This response takes longer than the idle limit; only idle sockets should be retired.
      await send(agent, '/slow');
      await send(baseline, '/fast');
      await sleep(driverIdleSocketTimeoutMs + 300);
      assert.equal(free(baseline), 1);
      assert.equal(free(agent), 0);
      assert.equal(await send(agent, '/fast'), false);
      assert.equal(connections, 3);
    } finally {
      baseline.destroy();
      agent.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
);
