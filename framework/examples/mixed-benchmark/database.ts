import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Pool } from 'pg';
import { FrameworkError, migrateDatabase } from '../../src/index.js';
import type { DatabaseOptions } from '../../src/index.js';
import type { Clock } from '../../src/core/clock.js';
import { PostgresDatabase, databaseSettings, poolConfig } from '../../src/database/postgres.js';
import type { Persistence } from '../../src/database/postgres.js';
import { MemoryPersistence } from '../../src/testing/memory-persistence.js';
import { accountFor, Histogram, plannedMeta, record } from './common.js';
import type { Meta, Profile } from './common.js';

/** Explicit disposable fixture only; no .env, TEST_DATABASE_* or business database fallback. */
export function benchmarkDatabaseOptions(value: unknown, max: number): DatabaseOptions {
  assert.ok(record(value), 'Invalid benchmark database configuration');
  assert.deepEqual(Object.keys(value).sort(), [
    'database',
    'host',
    'password',
    'port',
    'purpose',
    'user',
  ]);
  assert.ok(
    value.purpose === 'dou-bot-disposable-benchmark' &&
      value.host === '127.0.0.1' &&
      value.database === 'dou_bot_benchmark' &&
      value.user === 'dou_bot_benchmark',
    'Use a loopback disposable benchmark database',
  );
  assert.ok(typeof value.password === 'string' && value.password.length > 0);
  assert.ok(
    typeof value.port === 'number' &&
      Number.isSafeInteger(value.port) &&
      value.port > 0 &&
      value.port <= 65535,
  );
  assert.ok(Number.isSafeInteger(max) && max >= 1 && max <= 64);
  return {
    host: '127.0.0.1',
    port: value.port,
    database: 'dou_bot_benchmark',
    user: 'dou_bot_benchmark',
    password: value.password,
    schema: `dou_bot_bench_${randomUUID().replaceAll('-', '')}`,
    max,
    connectionTimeoutMs: 1500,
    statementTimeoutMs: 1000,
    idleTimeoutMs: 30000,
  };
}

interface BenchmarkDatabase {
  options: DatabaseOptions;
  persistence: Persistence;
  readUser?: (meta: Meta, appId: string, signal: AbortSignal) => Promise<void>;
  finish(): Promise<unknown>;
}

async function seedProfiles(control: Pool, schema: string, config: Profile): Promise<number> {
  const users = new Map<string, [string, string]>();
  const primary = config.phases.reduce(
    (sum, phase) => sum + Math.floor((phase.rate * phase.durationMs) / 1000),
    0,
  );
  for (let id = 1; id <= primary + config.concurrency + 16; id++) {
    const meta = plannedMeta(id, config);
    if (!meta) continue;
    const appId = accountFor(meta, config);
    users.set(JSON.stringify([appId, meta.userId]), [appId, meta.userId]);
  }
  await control.query(`CREATE TABLE "${schema}".benchmark_profiles (
    app_id text NOT NULL, user_id text NOT NULL, payload jsonb NOT NULL,
    PRIMARY KEY (app_id,user_id))`);
  const entries = [...users.values()];
  for (let offset = 0; offset < entries.length; offset += 1000) {
    const batch = entries.slice(offset, offset + 1000);
    await control.query(
      `INSERT INTO "${schema}".benchmark_profiles (app_id,user_id,payload)
       SELECT app_id,user_id,$3::jsonb FROM unnest($1::text[],$2::text[]) AS pairs(app_id,user_id)`,
      [
        batch.map((pair) => pair[0]),
        batch.map((pair) => pair[1]),
        JSON.stringify({ fixture: true, data: 'x'.repeat(256) }),
      ],
    );
  }
  await control.query(`ANALYZE "${schema}".benchmark_profiles`);
  return entries.length;
}

export async function createBenchmarkDatabase(
  config: Profile,
  clock: Clock,
  report: (error: unknown) => void,
): Promise<BenchmarkDatabase> {
  if (config.database !== 'postgres')
    return {
      options: { host: '127.0.0.1', user: 'offline', password: '', database: 'offline' },
      persistence: new MemoryPersistence(),
      finish: () => Promise.resolve({ kind: 'memory' }),
    };
  const file = process.env.DOU_BOT_BENCHMARK_DATABASE_FILE;
  assert.ok(file, 'Provide the explicit disposable database file');
  const info = await stat(file);
  assert.ok(info.isFile() && info.size <= 4096, 'Invalid database file');
  let input: unknown;
  try {
    input = JSON.parse(await readFile(file, 'utf8'));
  } catch {
    throw new Error('Invalid benchmark database JSON');
  }
  const options = benchmarkDatabaseOptions(input, config.databasePool ?? 25);
  const schema = options.schema!;
  const setup = { ...options, max: 1, connectionTimeoutMs: 5000, statementTimeoutMs: 10000 };
  const control = new Pool(poolConfig(databaseSettings(setup)));
  control.on('error', report);
  const store = new PostgresDatabase(databaseSettings(options), report, clock);
  const phases = Array.from({ length: config.phases.length + 1 }, () => ({
    attempts: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    latency: new Histogram(),
  }));
  let finished: Promise<unknown> | undefined;
  let profiles = 0;
  let version = '';
  const finish = () =>
    (finished ??= (async () => {
      await store.close(Infinity).catch(() => {});
      try {
        const deadline = performance.now() + 5000;
        while (store.pool.totalCount || store.pool.waitingCount) {
          assert.ok(performance.now() < deadline, 'Database pool did not drain');
          await delay(10);
        }
        const groups = await control.query<{ count: number }>(
          `SELECT count(*)::integer AS count FROM "${schema}".group_addresses`,
        );
        await control.query(`DROP SCHEMA "${schema}" CASCADE`);
        return {
          kind: 'postgres',
          version,
          poolLimit: options.max,
          profiles,
          groupAddresses: groups.rows[0]!.count,
          schemaDropped: true,
          phases: phases.map(({ latency, ...counts }) => ({
            ...counts,
            latencyIncludingPoolWait: latency.snapshot(),
          })),
        };
      } finally {
        await control.end();
      }
    })());
  try {
    await migrateDatabase(setup);
    profiles = await seedProfiles(control, schema, config);
    const result = await control.query<{ version: string }>(
      "SELECT current_setting('server_version') AS version",
    );
    version = result.rows[0]!.version;
  } catch (error) {
    await store.close(Infinity).catch(() => {});
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await control.end();
    throw error;
  }
  return {
    options,
    persistence: store,
    async readUser(meta, appId, signal) {
      const phase = phases[meta.phase]!;
      const start = performance.now();
      phase.attempts++;
      try {
        signal.throwIfAborted();
        const result = await store.query<{
          app_id: string;
          user_id: string;
          payload: { fixture: boolean };
        }>(
          `SELECT app_id,user_id,payload FROM "${schema}".benchmark_profiles WHERE app_id=$1 AND user_id=$2`,
          [appId, meta.userId],
        );
        signal.throwIfAborted();
        assert.equal(result.rows.length, 1);
        assert.equal(result.rows[0]!.app_id, appId);
        assert.equal(result.rows[0]!.user_id, meta.userId);
        assert.equal(result.rows[0]!.payload.fixture, true);
        phase.completed++;
      } catch (error) {
        if (signal.aborted) {
          phase.cancelled++;
          throw error;
        }
        phase.failed++;
        if (error instanceof assert.AssertionError) throw error;
        throw new FrameworkError('DATABASE', 'Benchmark profile lookup failed', { cause: error });
      } finally {
        phase.latency.add(performance.now() - start);
      }
    },
    finish,
  };
}
