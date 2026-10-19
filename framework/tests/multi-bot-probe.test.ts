import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { FrameworkError } from '../src/index.js';
import { createMultiTestApplication } from '../src/testing/index.js';
import {
  MultiBotProbe,
  multiBotProbeModule,
  probeDatabase,
  probeOptions,
} from '../examples/multi-bot-probe.js';
import type { ProbeRecord } from '../examples/multi-bot-probe.js';
import { probeFeed } from '../examples/multi-bot-probe-feed.js';
import { deferred, until } from './helpers.js';

const config = {
  QQ_APP_ID_A: 'a',
  QQ_APP_SECRET_A: 'secret-a',
  QQ_APP_ID_B: 'b',
  QQ_APP_SECRET_B: 'secret-b',
  DATABASE_HOST: '127.0.0.1',
  DATABASE_PORT: '1',
  DATABASE_USER: 'fixture',
  DATABASE_NAME: 'fixture',
  DATABASE_PASSWORD: '',
  DATABASE_SCHEMA: 'acceptance',
  DATABASE_SSL: 'false',
};

await test('multi-bot probe configuration requires fresh explicit settings and two distinct accounts', () => {
  const result = probeOptions(config);
  assert.equal(result.options.bots.length, 2);
  assert.equal(result.timeoutMs, 900000);
  assert.equal(result.options.database.password, '');
  assert.deepEqual(result.accounts, { A: 'a', B: 'b' });
  assert.throws(() => probeOptions({ ...config, QQ_APP_ID_B: 'a' }), /different/);
  assert.throws(() => probeOptions({ ...config, QQ_APP_SECRET_B: '' }), /QQ_APP_SECRET_B/);
  assert.throws(() => probeOptions({ ...config, PROBE_TIMEOUT_MS: '0' }), /PROBE_TIMEOUT_MS/);
  assert.throws(
    () => probeDatabase({ TEST_DATABASE_HOST: 'retired', TEST_DATABASE_PASSWORD: 'retired' }),
    /DATABASE_HOST/,
  );
  assert.throws(() => probeDatabase({ ...config, DATABASE_PORT: 'x' }), /DATABASE_PORT/);
  assert.throws(() => probeDatabase({ ...config, DATABASE_SSL: 'yes' }), /DATABASE_SSL/);
});

await test('multi-bot probe pins only nonce-matched conversations and pushes independently across account restart', async () => {
  const events: ProbeRecord[] = [];
  const root = multiBotProbeModule({
    accounts: { A: 'a', B: 'b' },
    nonce: 'fixture-code',
    record: (event) => events.push(event),
  });
  const h = await createMultiTestApplication(root, { bots: [{ appId: 'a' }, { appId: 'b' }] });
  await h.app.start();
  const message = (
    id: string,
    group: string,
    content = '/多机验收 fixture-code',
    user = 'user',
  ) => ({
    op: 0 as const,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id, group_openid: group, content, author: { member_openid: user } },
  });
  try {
    const probe = h.app.get(MultiBotProbe);
    await h.dispatch('a', message('wrong', 'other', '/多机验收 wrong'));
    assert.equal(h.messages.length, 0);
    await h.dispatch('a', message('a', 'group-a'));
    await h.dispatch('b', message('b', 'group-b'));
    await h.dispatch('a', message('another-group', 'other'));
    await h.dispatch('a', message('another-user', 'group-a', undefined, 'other-user'));
    assert.equal(h.messages.length, 2);
    assert.equal(probe.snapshot().distinctGroupOpenIds, true);
    await probe.verifyRoutes();
    assert.equal(events.filter((e) => e.event === 'route-check' && e.matches === true).length, 2);
    await probe.pushGroups(1);
    await h.app.bots.get('a').stop();
    await probe.pushGroups(2);
    assert.ok(
      events.some(
        (e) =>
          e.event === 'external-ws-send' &&
          e.account === 'A' &&
          e.sequence === 2 &&
          e.code === 'BOT_UNAVAILABLE',
      ),
    );
    assert.ok(
      events.some(
        (e) =>
          e.event === 'external-ws-send' &&
          e.account === 'B' &&
          e.sequence === 2 &&
          e.status === 'sent',
      ),
    );
    await h.app.bots.get('a').start();
    assert.equal(h.app.get(MultiBotProbe), probe);
    await probe.pushGroups(3);
    const sent = h.messages.slice(2);
    assert.deepEqual(
      sent.map((m) => m.appId),
      ['a', 'b', 'b', 'a', 'b'],
    );
    for (const m of sent)
      assert.deepEqual(m.target, {
        scene: 'group',
        groupId: m.appId === 'a' ? 'group-a' : 'group-b',
      });
    const serialized = JSON.stringify(events) + JSON.stringify(probe.snapshot());
    assert.ok(!serialized.includes('group-a') && !serialized.includes('group-b'));
    assert.ok(
      h.errors.every(
        (e) => e.error instanceof FrameworkError && e.error.code === 'BOT_UNAVAILABLE',
      ),
    );
  } finally {
    await h.app.close();
  }
});

await test('local probe feed crosses a real WS connection, serializes controls and closes pending work', async () => {
  const gate = deferred<void>();
  const seen: number[] = [];
  const feed = await probeFeed(async (sequence) => {
    seen.push(sequence);
    if (sequence === 2) await gate.promise;
  });
  try {
    await feed.send();
    assert.deepEqual(seen, [1]);
    const pending = feed.send();
    const rejected = assert.rejects(pending, /closed/);
    await until(() => seen.length === 2);
    await assert.rejects(feed.send(), /busy/);
    const closing = feed.close();
    assert.equal(feed.close(), closing);
    await closing;
    await rejected;
    gate.resolve();
    await assert.rejects(feed.send(), /closed/);
  } finally {
    gate.resolve();
    await feed.close();
  }
});

await test('multi-bot probe --check validates and closes without a database or QQ connection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dou-multi-probe-'));
  try {
    await writeFile(
      join(directory, '.env'),
      Object.entries(config)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join('\n'),
    );
    const script = fileURLToPath(new URL('../examples/live-multi-bot.js', import.meta.url));
    const { stdout } = await promisify(execFile)(process.execPath, [script, '--check'], {
      cwd: directory,
      timeout: 5000,
    });
    assert.ok(stdout.includes('configuration-valid'));
    assert.ok(!stdout.includes('secret-a') && !stdout.includes('secret-b'));
    assert.ok(!stdout.includes('ready"'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
