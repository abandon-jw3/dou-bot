import assert from 'node:assert/strict';
import { createPrivateKey, createPublicKey, verify } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  Histogram,
  event,
  makeMeta,
  metadata,
  profile,
  record,
  secret,
  signedHeaders,
} from '../examples/mixed-benchmark/common.js';

await test('mixed benchmark persists large child reports before IPC completion and exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dou-mixed-report-'));
  const path = join(directory, 'report.json');
  const childPath = join(directory, 'child.mjs');
  try {
    const helper = new URL('../examples/mixed-benchmark/common.js', import.meta.url).href;
    await writeFile(
      childPath,
      `import { finishReport } from ${JSON.stringify(helper)};\nawait finishReport('complete', { data: 'x'.repeat(2000000) }, ${JSON.stringify(path)});\nprocess.disconnect();\n`,
    );
    const child = fork(childPath, [], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    let notice: unknown;
    child.on('message', (message: unknown) => {
      notice = message;
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(exitCode, 0);
    assert.deepEqual(notice, { type: 'complete', reportPath: path });
    const report: unknown = JSON.parse(await readFile(path, 'utf8'));
    assert.ok(record(report) && typeof report.data === 'string');
    assert.equal(report.data.length, 2000000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test('mixed benchmark records latency tails and overflow rather than dropping slow events', () => {
  const histogram = new Histogram();
  assert.equal(histogram.snapshot().count, 0);
  for (let i = 0; i < 98; i++) histogram.add(1.1);
  histogram.add(1000.1);
  histogram.add(70000);
  const result = histogram.snapshot();
  assert.equal(result.count, 100);
  assert.equal(result.p95UpperMs, 2);
  assert.equal(result.p99UpperMs, 1001);
  assert.equal(result.maxMs, 70000);
  assert.ok(result.meanMs > 700);
  const overflow = new Histogram();
  overflow.add(70000);
  assert.equal(overflow.snapshot().p99UpperMs, null);
  assert.throws(() => histogram.add(-1));
  assert.throws(() => histogram.add(NaN));
});

await test('mixed benchmark deterministic primary mix covers all routes, roles and 2000 groups', () => {
  const config = profile('standard');
  const kinds = new Set<string>(),
    groups = new Set<string>(),
    roles = new Set<string>(),
    modes = new Set<string>();
  let groupCount = 0,
    hotspot = 0;
  for (let id = 1; id <= 100000; id++) {
    const meta = makeMeta(id, 0, 1n, config);
    kinds.add(meta.kind);
    roles.add(meta.role);
    if (meta.kind === 'prompt') modes.add(meta.promptMode);
    if (meta.scene === 'group') {
      groupCount++;
      groups.add(meta.groupId);
      if (meta.groupId === 'group-0') hotspot++;
    }
  }
  assert.equal(kinds.size, 9);
  assert.equal(groups.size, 2000);
  assert.equal(roles.size, 3);
  assert.deepEqual([...modes].sort(), ['cancelled', 'received', 'timeout']);
  assert.ok(groupCount > 83000 && groupCount < 87000);
  assert.ok(hotspot / groupCount > 0.18 && hotspot / groupCount < 0.22);
  assert.deepEqual(makeMeta(42, 0, 1n, config), makeMeta(42, 0, 1n, config));
  assert.throws(() => profile('unknown'));
});

await test('mixed benchmark signs complete bytes and keeps attachment events text-free', () => {
  const meta = makeMeta(1, 0, 1n, profile('smoke'), 'file');
  const payload = event(meta);
  assert.equal(metadata(payload)?.id, 1);
  assert.ok(record(payload.d));
  assert.equal(payload.d.content, '');
  const body = Buffer.from(JSON.stringify(payload));
  const headers = signedHeaders(body);
  const seed = Buffer.alloc(32);
  const bytes = Buffer.from(secret);
  for (let i = 0; i < 32; i++) seed[i] = bytes[i % bytes.length]!;
  const privateKey = createPrivateKey({
    key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
    type: 'pkcs8',
    format: 'der',
  });
  const key = createPublicKey(privateKey);
  const stamp = Buffer.from(headers['x-signature-timestamp']!);
  const signature = Buffer.from(headers['x-signature-ed25519']!, 'hex');
  assert.ok(verify(null, Buffer.concat([stamp, body]), key, signature));
  assert.ok(!verify(null, Buffer.concat([stamp, body, Buffer.from(' ')]), key, signature));
});
