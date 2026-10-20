import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { DatabaseOptions } from '../src/index.js';
import { migrateDatabase } from '../src/index.js';
import { PostgresDatabase, databaseSettings, poolConfig } from '../src/database/postgres.js';
import { until } from './helpers.js';

const configured = ['HOST', 'USER', 'NAME'].every((key) => process.env[`TEST_DATABASE_${key}`]);
export const postgresTest = {
  skip: !configured && process.env.DOUBOT_REQUIRE_TEST_DATABASE !== '1',
  timeout: 30000,
};

/** Dedicated connection settings only; each test owns its random schema and pool. */
export async function withPostgres(
  run: (fixture: {
    store: PostgresDatabase;
    control: Pool;
    options: DatabaseOptions;
    reports: unknown[];
  }) => Promise<void>,
  overrides: Pick<
    DatabaseOptions,
    'max' | 'connectionTimeoutMs' | 'statementTimeoutMs' | 'idleTimeoutMs'
  > = {},
): Promise<void> {
  assert.ok(configured, 'Configure dedicated TEST_DATABASE_HOST, USER and NAME');
  const schema = `dou_bot_test_${randomUUID().replaceAll('-', '')}`;
  const options: DatabaseOptions = {
    host: process.env.TEST_DATABASE_HOST!,
    port: Number(process.env.TEST_DATABASE_PORT ?? 5432),
    user: process.env.TEST_DATABASE_USER!,
    password: process.env.TEST_DATABASE_PASSWORD ?? '',
    database: process.env.TEST_DATABASE_NAME!,
    ssl: process.env.TEST_DATABASE_SSL === 'true',
    schema,
    max: 2,
    connectionTimeoutMs: 1500,
    statementTimeoutMs: 5000,
    ...overrides,
  };
  const setup = { ...options, max: 1, connectionTimeoutMs: 5000, statementTimeoutMs: 5000 };
  const control = new Pool(poolConfig(databaseSettings(setup)));
  control.on('error', () => {});
  const reports: unknown[] = [];
  const store = new PostgresDatabase(databaseSettings(options), (error) => reports.push(error));
  try {
    await migrateDatabase(setup);
    await store.open();
    await run({ store, control, options, reports });
  } finally {
    try {
      // A test may deliberately have exhausted its close deadline.
      await store.close(performance.now() + 2000).catch(() => {});
      await until(() => store.pool.totalCount === 0 && store.pool.waitingCount === 0);
    } finally {
      try {
        await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await control.end();
      }
    }
  }
}

/** The PID is obtained from this test's borrowed connection, never from a global session scan. */
export async function terminateOwnBackend(control: Pool, pid: number): Promise<void> {
  const result = await control.query<{ terminated: boolean }>(
    `SELECT pg_terminate_backend(pid) AS terminated
     FROM pg_stat_activity
     WHERE pid=$1 AND datname=current_database() AND usename=current_user
       AND application_name='dou-bot'`,
    [pid],
  );
  assert.deepEqual(result.rows, [{ terminated: true }]);
}
