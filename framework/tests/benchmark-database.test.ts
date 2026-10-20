import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  benchmarkDatabaseOptions,
  createBenchmarkDatabase,
} from '../examples/mixed-benchmark/database.js';
import { comparisonProfile, profile } from '../examples/mixed-benchmark/common.js';
import { CountingClock } from '../examples/soak-support.js';

const input = {
  purpose: 'dou-bot-disposable-benchmark',
  host: '127.0.0.1',
  port: 55432,
  user: 'dou_bot_benchmark',
  database: 'dou_bot_benchmark',
  password: 'fixture-only',
};

await test('SQL benchmark accepts only an explicit isolated fixture and owns a new schema', () => {
  const first = benchmarkDatabaseOptions(input, 25);
  const second = benchmarkDatabaseOptions(input, 4);
  assert.match(first.schema!, /^dou_bot_bench_[a-f0-9]{32}$/u);
  assert.notEqual(first.schema, second.schema);
  assert.equal(first.max, 25);
  assert.equal(second.max, 4);
  for (const change of [
    { purpose: 'production' },
    { host: 'example.com' },
    { user: 'business' },
    { database: 'business' },
    { password: undefined },
    { password: '' },
    { port: 0 },
    { port: 1.5 },
    { schema: 'public' },
    { ssl: true },
    { url: 'postgres://localhost' },
  ])
    assert.throws(() => benchmarkDatabaseOptions({ ...input, ...change }, 25));
  for (const max of [0, 65, NaN, 1.5]) assert.throws(() => benchmarkDatabaseOptions(input, max));
});

await test('SQL selection is recorded and memory comparisons cannot configure a SQL pool', () => {
  const config = {
    kind: 'comparison',
    concurrency: 32,
    outboundConcurrency: 8,
    rate: 200,
    durationMs: 1000,
  };
  assert.equal(comparisonProfile(config).database, 'memory');
  const sql = comparisonProfile({ ...config, database: 'postgres', databasePool: 4 });
  assert.equal(sql.database, 'postgres');
  assert.equal(sql.databasePool, 4);
  for (const extra of [
    { database: 'unknown' },
    { databasePool: 25 },
    { database: 'postgres', databasePool: 0 },
    { databaseFile: 'private.json' },
  ])
    assert.throws(() => comparisonProfile({ ...config, ...extra }));
});

await test('benchmark memory mode ignores ambient database files and malformed SQL files do not disclose their content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dou-sql-fixture-'));
  const previous = process.env.DOU_BOT_BENCHMARK_DATABASE_FILE;
  const clock = new CountingClock();
  try {
    process.env.DOU_BOT_BENCHMARK_DATABASE_FILE = join(directory, 'missing.json');
    const memory = await createBenchmarkDatabase(profile('smoke'), clock, () => assert.fail());
    assert.deepEqual(await memory.finish(), { kind: 'memory' });
    const path = join(directory, 'invalid.json');
    await writeFile(path, '{"password":"must-not-be-in-error",broken');
    process.env.DOU_BOT_BENCHMARK_DATABASE_FILE = path;
    await assert.rejects(
      createBenchmarkDatabase({ ...profile('smoke'), database: 'postgres' }, clock, () =>
        assert.fail(),
      ),
      (error: unknown) =>
        error instanceof Error && error.message === 'Invalid benchmark database JSON',
    );
  } finally {
    if (previous === undefined) delete process.env.DOU_BOT_BENCHMARK_DATABASE_FILE;
    else process.env.DOU_BOT_BENCHMARK_DATABASE_FILE = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
