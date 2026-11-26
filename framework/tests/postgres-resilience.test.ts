import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError, migrateDatabase } from '../src/index.js';
import { deferred, until } from './helpers.js';
import { postgresTest, terminateOwnBackend, withPostgres } from './postgres-fixture.js';

const errorCode = (code: string) => (error: unknown) =>
  error instanceof Error && 'code' in error && error.code === code;

await test(
  'real PostgreSQL pool checkout is bounded and recovers after timeout',
  postgresTest,
  () =>
    withPostgres(
      async ({ store }) => {
        const client = await store.pool.connect();
        const waiting = store.query('SELECT 99 AS value').catch((error: unknown) => error);
        try {
          await until(() => store.pool.waitingCount === 1);
          assert.equal(store.pool.totalCount, 1);
          assert.equal(store.pool.idleCount, 0);
          assert.ok((await waiting) instanceof Error);
          assert.equal(store.pool.waitingCount, 0);
        } finally {
          client.release();
        }
        assert.deepEqual((await store.query('SELECT 42 AS value')).rows, [{ value: 42 }]);
        assert.equal(store.pool.totalCount, 1);
      },
      { max: 1, connectionTimeoutMs: 1000 },
    ),
);

await test(
  'real PostgreSQL SQL timeouts roll back transactions and allow later queries',
  postgresTest,
  () =>
    withPostgres(
      async ({ store }) => {
        await store.query(
          `CREATE TABLE "${store.schema}".timeout_fixture (id integer PRIMARY KEY)`,
        );
        await assert.rejects(store.query('SELECT pg_sleep(5)'), errorCode('57014'));
        let calls = 0;
        await assert.rejects(
          store.transaction(async (client) => {
            calls++;
            await client.query(`INSERT INTO "${store.schema}".timeout_fixture VALUES (1)`);
            await client.query('SELECT pg_sleep(5)');
          }),
          errorCode('57014'),
        );
        assert.equal(calls, 1, 'The framework must not retry a transaction callback');
        assert.deepEqual(
          (await store.query(`SELECT * FROM "${store.schema}".timeout_fixture`)).rows,
          [],
        );
        assert.deepEqual((await store.query('SELECT 42 AS value')).rows, [{ value: 42 }]);
        assert.equal(store.pool.waitingCount, 0);
      },
      { max: 1, statementTimeoutMs: 500 },
    ),
);

await test(
  'real PostgreSQL replaces a failed idle connection and preserves persisted routes',
  postgresTest,
  () =>
    withPostgres(
      async ({ store, control, reports }) => {
        await store.registerBots(['a']);
        await store.bind('a', 'group-a');
        const { rows } = await store.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        await terminateOwnBackend(control, rows[0]!.pid);
        await until(() => reports.length === 1);
        assert.ok(reports[0] instanceof FrameworkError && reports[0].code === 'DATABASE');
        assert.deepEqual(await store.lookup('group-a'), { candidates: ['a'], explicit: 'a' });
        const next = await store.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        assert.notEqual(next.rows[0]!.pid, rows[0]!.pid);
        assert.equal(reports.length, 1);
      },
      { max: 1 },
    ),
);

await test(
  'real PostgreSQL transaction disconnect while awaiting business work does not crash or replay',
  postgresTest,
  () =>
    withPostgres(
      async ({ store, control }) => {
        const entered = deferred<number>();
        const resume = deferred<void>();
        let disconnected = false;
        let calls = 0;
        const transaction = store.transaction(async (client) => {
          calls++;
          client.once('end', () => {
            disconnected = true;
          });
          const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          entered.resolve(result.rows[0]!.pid);
          await resume.promise;
          return 'must-not-commit';
        });
        const outcome = transaction.catch((error: unknown) => error);
        try {
          await terminateOwnBackend(control, await entered.promise);
          await until(() => disconnected);
        } finally {
          resume.resolve();
        }
        assert.ok(errorCode('57P01')(await outcome), 'Preserve the original connection failure');
        assert.equal(calls, 1);
        assert.deepEqual((await store.query('SELECT 42 AS value')).rows, [{ value: 42 }]);
      },
      { max: 1 },
    ),
);

await test(
  'real PostgreSQL migration disconnect rejects without an uncaught client error',
  postgresTest,
  () =>
    withPostgres(async ({ store, control, options }) => {
      const holder = await control.connect();
      const { rows } = await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dou-bot:${store.schema}`]);
      const migration = migrateDatabase(options).catch((error: unknown) => error);
      try {
        const deadline = performance.now() + 3000;
        let pid: number | undefined;
        while (pid === undefined && performance.now() < deadline) {
          // Only the migration blocked by this test's random-schema lock is eligible.
          await holder.query('SELECT pg_stat_clear_snapshot()');
          const waiting = await holder.query<{ pid: number }>(
            `SELECT pid FROM pg_stat_activity
           WHERE datname=current_database() AND usename=current_user
             AND application_name='dou-bot' AND $1::integer=ANY(pg_blocking_pids(pid))`,
            [rows[0]!.pid],
          );
          assert.ok(waiting.rows.length <= 1);
          pid = waiting.rows[0]?.pid;
          if (pid === undefined) await new Promise<void>((resolve) => setTimeout(resolve, 5));
        }
        assert.ok(pid !== undefined, 'Migration did not wait for its advisory lock');
        const terminated = await holder.query<{ terminated: boolean }>(
          'SELECT pg_terminate_backend($1) AS terminated',
          [pid],
        );
        assert.equal(terminated.rows[0]!.terminated, true);
        const error = await migration;
        assert.ok(error instanceof FrameworkError && error.code === 'DATABASE');
      } finally {
        await holder.query('ROLLBACK');
        holder.release();
        await migration;
      }
      await migrateDatabase(options);
      assert.deepEqual((await store.query('SELECT 42 AS value')).rows, [{ value: 42 }]);
    }),
);

await test(
  'real PostgreSQL force close reclaims a borrowed client waiting outside SQL',
  postgresTest,
  () =>
    withPostgres(async ({ store }) => {
      await store.pool.connect();
      await assert.rejects(store.close(performance.now() + 30), errorCode('SHUTDOWN_TIMEOUT'));
      await until(() => store.pool.totalCount === 0);
      assert.equal(store.pool.idleCount, 0);
    }),
);

await test(
  'real PostgreSQL force close releases an already disconnected transaction',
  postgresTest,
  () =>
    withPostgres(async ({ store, control }) => {
      const entered = deferred<number>();
      const resume = deferred<void>();
      let ended = false;
      const pending = store.transaction(async (client) => {
        client.once('end', () => {
          ended = true;
        });
        const result = await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
        entered.resolve(result.rows[0]!.pid);
        await resume.promise;
      });
      const outcome = pending.catch((error: unknown) => error);
      try {
        await terminateOwnBackend(control, await entered.promise);
        await until(() => ended);
        await assert.rejects(store.close(performance.now() + 30), errorCode('SHUTDOWN_TIMEOUT'));
        await until(() => store.pool.totalCount === 0);
      } finally {
        resume.resolve();
        await outcome;
      }
      assert.ok(errorCode('57P01')(await outcome));
    }),
);

for (const entry of ['query', 'pool.query', 'borrowed'] as const)
  await test(
    `real PostgreSQL close deadline interrupts ${entry} and queued work cannot start`,
    postgresTest,
    () =>
      withPostgres(
        async ({ store, control }) => {
          const { rows } = await store.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          const borrowed = entry === 'borrowed' ? await store.pool.connect() : undefined;
          const query = borrowed
            ? borrowed.query('SELECT pg_sleep(10)').finally(() => borrowed.release())
            : entry === 'query'
              ? store.query('SELECT pg_sleep(10)')
              : store.pool.query('SELECT pg_sleep(10)');
          const active = query.catch((error: unknown) => error);
          // Observe the owned backend so shutdown cannot race before the slow SQL starts.
          const deadline = performance.now() + 3000;
          let running = false;
          while (!running && performance.now() < deadline) {
            const result = await control.query<{ running: boolean }>(
              `SELECT state='active' AND wait_event='PgSleep' AS running
           FROM pg_stat_activity WHERE pid=$1`,
              [rows[0]!.pid],
            );
            running = result.rows[0]?.running === true;
            if (!running) await new Promise<void>((resolve) => setTimeout(resolve, 5));
          }
          assert.ok(running, 'Owned backend did not enter pg_sleep');
          let callbackStarted = false;
          const queued = store
            .transaction(() => {
              callbackStarted = true;
            })
            .catch((error: unknown) => error);
          await until(() => store.pool.waitingCount === 1);
          await assert.rejects(store.close(performance.now() + 30), errorCode('SHUTDOWN_TIMEOUT'));
          assert.ok((await active) instanceof Error);
          assert.ok((await queued) instanceof Error);
          assert.equal(callbackStarted, false);
          await until(() => store.pool.totalCount === 0 && store.pool.waitingCount === 0);
          await assert.rejects(store.query('SELECT 1'), errorCode('INVALID_STATE'));
        },
        { max: 1, connectionTimeoutMs: 500, statementTimeoutMs: 15000 },
      ),
  );
