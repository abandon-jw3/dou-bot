import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo, Socket } from 'node:net';
import { Pool } from 'pg';
import {
  Database,
  GroupRoutes,
  MessageSender,
  Module,
  Controller,
  Command,
  migrateDatabase,
  FrameworkError,
} from '../src/index.js';
import type { DatabaseOptions } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { PostgresDatabase, databaseSettings, poolConfig } from '../src/database/postgres.js';
import { createFixtures } from '../src/testing/fixtures.js';
import { deferred, until } from './helpers.js';

const present = ['HOST', 'USER', 'NAME'].every((key) =>
  Boolean(process.env[`TEST_DATABASE_${key}`]),
);
const required = process.env.DOUBOT_REQUIRE_TEST_DATABASE === '1';
const code = (name: string) => (error: unknown) =>
  error instanceof FrameworkError && error.code === name;

await test('PostgreSQL connection failures are not reported as schema migration failures', async () => {
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const store = new PostgresDatabase(
    databaseSettings({
      host: '127.0.0.1',
      port: (server.address() as AddressInfo).port,
      user: 'fixture',
      password: '',
      database: 'fixture',
      connectionTimeoutMs: 1000,
    }),
    () => {},
  );
  try {
    await assert.rejects(store.open(), code('DATABASE'));
  } finally {
    await store.close(Infinity);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

await test(
  'PostgreSQL shutdown deadline cancels a connection still waiting for its handshake',
  { timeout: 5000 },
  async () => {
    for (const ssl of [false, true]) {
      let peer: Socket | undefined;
      let packets = 0;
      let handshakeWaiting = false;
      const server = createServer((socket) => {
        peer = socket;
        socket.on('data', () => {
          packets++;
          if (ssl && packets === 1) socket.write('S');
          else handshakeWaiting = true;
        });
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const store = new PostgresDatabase(
        databaseSettings({
          host: '127.0.0.1',
          port: (server.address() as AddressInfo).port,
          user: 'fixture',
          password: '',
          database: 'fixture',
          connectionTimeoutMs: 3000,
          ssl,
        }),
        () => {},
      );
      const opening = store.open().catch((error: unknown) => error);
      try {
        await until(() => handshakeWaiting);
        await assert.rejects(store.close(performance.now() + 10), code('SHUTDOWN_TIMEOUT'));
        await until(() => peer!.destroyed, 500);
        assert.ok((await opening) instanceof FrameworkError);
        assert.equal(store.pool.totalCount, 0);
      } finally {
        peer?.destroy();
        await opening;
        await store.close(Infinity).catch(() => {});
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    }
  },
);

await test('PostgreSQL options reject unsafe identifiers, preserve empty passwords and have bounded defaults', () => {
  const input = { host: 'localhost', user: 'fixture', password: '', database: 'fixture' };
  const config = databaseSettings(input);
  assert.equal(config.schema, 'dou_bot');
  assert.equal(config.max, 25);
  assert.equal(config.connectionTimeoutMs, 5000);
  assert.equal(config.statementTimeoutMs, 10000);
  assert.equal(config.idleTimeoutMs, 30000);
  const previous = process.env.PGPASSWORD;
  process.env.PGPASSWORD = 'must-not-be-used';
  try {
    const password = poolConfig(config).password;
    assert.equal(typeof password, 'function');
    assert.equal((password as () => string)(), '');
  } finally {
    if (previous === undefined) delete process.env.PGPASSWORD;
    else process.env.PGPASSWORD = previous;
  }
  for (const schema of ['a.b', 'x"; DROP SCHEMA public', '', 'a'.repeat(64)])
    assert.throws(() => databaseSettings({ ...input, schema }), code('CONFIG'));
  assert.throws(() => databaseSettings({ ...input, statementTimeoutMs: 0 }), code('CONFIG'));
});

await test(
  'real PostgreSQL migration, routing, restart, transactions and concurrent observations',
  { skip: !present && !required, timeout: 60000 },
  async () => {
    assert.ok(
      present,
      'Set dedicated TEST_DATABASE_HOST, USER and NAME. No business DATABASE_* fallback is allowed.',
    );
    const schema = `dou_bot_test_${randomUUID().replaceAll('-', '')}`;
    const database: DatabaseOptions = {
      host: process.env.TEST_DATABASE_HOST!,
      user: process.env.TEST_DATABASE_USER!,
      database: process.env.TEST_DATABASE_NAME!,
      password: process.env.TEST_DATABASE_PASSWORD ?? '',
      port: Number(process.env.TEST_DATABASE_PORT ?? 5432),
      ssl: process.env.TEST_DATABASE_SSL === 'true',
      schema,
      max: 4,
      connectionTimeoutMs: 5000,
      statementTimeoutMs: 5000,
    };
    const cleanup = new Pool(poolConfig(databaseSettings(database)));
    cleanup.on('error', () => {});
    const stores: PostgresDatabase[] = [];
    const apps: Application[] = [];
    const fixture = createFixtures({});
    @Controller()
    class Commands {
      @Command('ping') ping() {
        return 'pong';
      }
    }
    @Module({ controllers: [Commands] })
    class Root {}
    const options = {
      database,
      bots: [
        { appId: 'a', secret: 'test-a' },
        { appId: 'b', secret: 'test-b' },
      ],
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    };
    const ports = {
      fetch: fixture.fetcher,
      transport: () => ({ start: async () => {}, stop: async () => {} }),
    };
    try {
      const missing = new PostgresDatabase(databaseSettings(database), () => {});
      stores.push(missing);
      await assert.rejects(missing.open(), code('DATABASE_SCHEMA'));
      await missing.close(Infinity);
      await Promise.all([migrateDatabase(database), migrateDatabase(database)]);
      await migrateDatabase(database);
      const app = await Application.create(Root, options, ports);
      apps.push(app);
      await app.start();
      const db = app.get(Database);
      const routes = app.get(GroupRoutes);
      assert.equal(db.pool, app.store.database.pool);
      await Promise.all(Array.from({ length: 30 }, () => app.store.observe('a', 'ga')));
      await app.store.observe('b', 'gb');
      assert.equal((await routes.list('ga')).length, 1);
      assert.equal((await routes.resolve('ga')).appId, 'a');
      assert.equal((await routes.resolve('gb')).appId, 'b');
      await app.store.observe('b', 'ga');
      await assert.rejects(routes.resolve('ga'), code('ROUTE_AMBIGUOUS'));
      await routes.bind({ scene: 'group', appId: 'a', groupId: 'ga' });
      assert.equal((await routes.resolve('ga')).appId, 'a');
      // Business migrations are explicit and remain outside framework-managed tables.
      await db.query(`CREATE TABLE "${schema}".business_fixture (id integer PRIMARY KEY)`);
      await assert.rejects(
        db.transaction(async (client) => {
          await client.query(`INSERT INTO "${schema}".business_fixture VALUES (1)`);
          throw new Error('rollback');
        }),
        /rollback/,
      );
      assert.equal((await db.query(`SELECT * FROM "${schema}".business_fixture`)).rows.length, 0);
      await db.transaction(async (client) => {
        await client.query(`INSERT INTO "${schema}".business_fixture VALUES (2)`);
      });
      await app.close();
      const resumed = await Application.create(Root, options, ports);
      apps.push(resumed);
      await resumed.start();
      assert.equal((await resumed.get(GroupRoutes).resolve('ga')).appId, 'a');
      await resumed.get(MessageSender).sendMessage({ scene: 'group', groupId: 'ga' }, 'persisted');
      assert.equal(fixture.botMessages.at(-1)?.appId, 'a');
      await resumed.get(GroupRoutes).unbind('ga');
      await assert.rejects(resumed.get(GroupRoutes).resolve('ga'), code('ROUTE_AMBIGUOUS'));
      await resumed.close();
      // Schema incompatibility is fatal rather than an automatic mutation or memory fallback.
      await cleanup.query(`UPDATE "${schema}".schema_version SET version=999`);
      const incompatible = await Application.create(Root, options, ports);
      apps.push(incompatible);
      await assert.rejects(incompatible.start(), code('DATABASE_SCHEMA'));
      assert.equal(incompatible.status, 'failed');
    } finally {
      for (const app of apps) await app.close().catch(() => {});
      for (const store of stores) await store.close(Infinity).catch(() => {});
      // The random test schema is the only deletion target.
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    }
  },
);

await test(
  'PostgreSQL close waits for a borrowed ORM connection, then rejects new framework queries',
  { skip: !present, timeout: 15000 },
  async () => {
    const schema = `dou_bot_test_${randomUUID().replaceAll('-', '')}`;
    const options: DatabaseOptions = {
      host: process.env.TEST_DATABASE_HOST!,
      user: process.env.TEST_DATABASE_USER!,
      database: process.env.TEST_DATABASE_NAME!,
      password: process.env.TEST_DATABASE_PASSWORD ?? '',
      port: Number(process.env.TEST_DATABASE_PORT ?? 5432),
      ssl: process.env.TEST_DATABASE_SSL === 'true',
      schema,
    };
    const cleanup = new Pool(poolConfig(databaseSettings(options)));
    cleanup.on('error', () => {});
    await migrateDatabase(options);
    const store = new PostgresDatabase(databaseSettings(options), () => {});
    try {
      await store.open();
      const client = await store.pool.connect();
      const release = deferred<void>();
      let closed = false;
      const closing = store.close(performance.now() + 3000).then(() => {
        closed = true;
      });
      await Promise.resolve();
      assert.equal(closed, false);
      release.resolve();
      await release.promise;
      client.release();
      await closing;
      await assert.rejects(store.query('SELECT 1'), code('INVALID_STATE'));
    } finally {
      await store.close(Infinity).catch(() => {});
      await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await cleanup.end();
    }
  },
);
