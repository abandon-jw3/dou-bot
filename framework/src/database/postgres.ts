import { Pool } from 'pg';
import { Socket } from 'node:net';
import type { PoolClient, PoolConfig, QueryResult, QueryResultRow } from 'pg';
import { Database } from '../contracts.js';
import type { Awaitable, DatabaseOptions } from '../contracts.js';
import { FrameworkError } from '../core/errors.js';
import { integer, keys } from '../core/config-validation.js';
import { bounded, isRecord, nonempty } from '../core/utils.js';
import { systemClock } from '../core/clock.js';
import type { Clock } from '../core/clock.js';

export const SCHEMA_VERSION = 1;
export type DatabaseSettings = Required<DatabaseOptions>;
export function databaseSettings(input: DatabaseOptions): DatabaseSettings {
  keys(
    input,
    [
      'host',
      'user',
      'password',
      'database',
      'port',
      'ssl',
      'schema',
      'max',
      'connectionTimeoutMs',
      'statementTimeoutMs',
      'idleTimeoutMs',
    ],
    'database',
  );
  nonempty(input.host, 'database.host');
  nonempty(input.user, 'database.user');
  nonempty(input.database, 'database.database');
  if (typeof input.password !== 'string')
    throw new FrameworkError('CONFIG', 'database.password must be a string');
  const schema = input.schema ?? 'dou_bot';
  if (!/^[a-z_][a-z0-9_]{0,62}$/u.test(schema))
    throw new FrameworkError('CONFIG', 'Invalid database.schema');
  let ssl = input.ssl ?? false;
  if (typeof ssl !== 'boolean') {
    keys(ssl, ['ca', 'rejectUnauthorized'], 'database.ssl');
    nonempty(ssl.ca, 'database.ssl.ca');
    if (ssl.rejectUnauthorized !== undefined && typeof ssl.rejectUnauthorized !== 'boolean')
      throw new FrameworkError('CONFIG', 'Invalid database.ssl.rejectUnauthorized');
    ssl = Object.freeze({ ...ssl });
  }
  return Object.freeze({
    host: input.host,
    user: input.user,
    password: input.password,
    database: input.database,
    ssl,
    schema,
    port: integer(input.port, 5432, 'database.port', 1, 65535),
    max: integer(input.max, 25, 'database.max'),
    connectionTimeoutMs: integer(input.connectionTimeoutMs, 5000, 'database.connectionTimeoutMs'),
    statementTimeoutMs: integer(input.statementTimeoutMs, 10000, 'database.statementTimeoutMs'),
    idleTimeoutMs: integer(input.idleTimeoutMs, 30000, 'database.idleTimeoutMs'),
  });
}
export function poolConfig(settings: DatabaseSettings): PoolConfig {
  return {
    host: settings.host,
    port: settings.port,
    user: settings.user,
    database: settings.database,
    // A callback preserves an explicitly empty password instead of falling back to PGPASSWORD.
    password: () => settings.password,
    ssl: settings.ssl,
    max: settings.max,
    connectionTimeoutMillis: settings.connectionTimeoutMs,
    statement_timeout: settings.statementTimeoutMs,
    idleTimeoutMillis: settings.idleTimeoutMs,
    application_name: 'dou-bot',
    options: '',
    // pg 8.23 awaits onConnect; its published type still declares void. Real PostgreSQL coverage verifies this hook.
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    onConnect: async (client) => {
      await client.query('SET search_path TO public');
    },
  };
}

export interface Persistence {
  readonly database: Database;
  open(): Promise<void>;
  registerBots(appIds: readonly string[]): Promise<void>;
  observe(appId: string, groupId: string): Promise<void>;
  candidates(groupId: string): Promise<readonly string[]>;
  lookup(groupId: string): Promise<{ explicit?: string; candidates: readonly string[] }>;
  bind(appId: string, groupId: string): Promise<void>;
  unbind(groupId: string): Promise<void>;
  close(deadline: number): Promise<void>;
}

/** One application owns one pool. SQL identifiers come only from validated schema configuration. */
export class PostgresDatabase extends Database implements Persistence {
  readonly database = this;
  readonly pool: Pool;
  readonly schema: string;
  private closed = false;
  private ready = false;
  private closing?: Promise<void>;
  private readonly borrowed = new Set<PoolClient>();
  private readonly sockets = new Set<Socket>();
  constructor(
    settings: DatabaseSettings,
    report: (error: unknown) => void,
    private readonly clock: Clock = systemClock,
  ) {
    super();
    this.schema = settings.schema;
    this.pool = new Pool({
      ...poolConfig(settings),
      stream: () => {
        // Track connections before authentication/onConnect finishes, when no PoolClient
        // is available yet. This also owns the underlying socket when pg enables TLS.
        const socket = new Socket();
        this.sockets.add(socket);
        socket.once('close', () => this.sockets.delete(socket));
        return socket;
      },
    });
    this.pool.on('error', () =>
      report(new FrameworkError('DATABASE', 'PostgreSQL idle connection failed')),
    );
    this.pool.on('acquire', (client: PoolClient) => this.borrowed.add(client));
    this.pool.on('release', (_error, client: PoolClient) => this.borrowed.delete(client));
    this.pool.on('remove', (client: PoolClient) => this.borrowed.delete(client));
  }
  override async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<R>> {
    this.assertReady();
    return this.pool.query<R>(sql, values === undefined ? undefined : [...values]);
  }
  override async transaction<T>(run: (client: PoolClient) => Awaitable<T>): Promise<T> {
    this.assertReady();
    const client = await this.pool.connect();
    let broken = false;
    try {
      this.assertReady();
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      if (this.borrowed.has(client)) client.release(broken);
    }
  }
  private assertReady(): void {
    if (this.closed || !this.ready)
      throw new FrameworkError('INVALID_STATE', 'Database is not available');
  }
  async open(): Promise<void> {
    if (this.closed) throw new FrameworkError('INVALID_STATE', 'Database is closed');
    try {
      const result = await this.pool.query<{ version: number }>(
        `SELECT version FROM "${this.schema}".schema_version WHERE singleton = true`,
      );
      if (result.rows.length !== 1 || result.rows[0]?.version !== SCHEMA_VERSION)
        throw new FrameworkError(
          'DATABASE_SCHEMA',
          'Unsupported framework schema version; run migrateDatabase explicitly',
        );
      if (this.closed) throw new FrameworkError('INVALID_STATE', 'Database is closed');
      this.ready = true;
    } catch (error) {
      if (error instanceof FrameworkError) throw error;
      const missingSchema =
        isRecord(error) && ['3F000', '42P01', '42703'].includes(String(error.code));
      throw new FrameworkError(
        missingSchema ? 'DATABASE_SCHEMA' : 'DATABASE',
        missingSchema
          ? 'Framework schema is missing or incomplete; run migrateDatabase explicitly'
          : 'Cannot connect to or query PostgreSQL; check connectivity, credentials and permissions',
        { cause: error },
      );
    }
  }
  async registerBots(appIds: readonly string[]): Promise<void> {
    await this.query(
      `INSERT INTO "${this.schema}".bots (app_id) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING`,
      [appIds],
    );
  }
  async observe(appId: string, groupId: string): Promise<void> {
    await this.query(
      `INSERT INTO "${this.schema}".group_addresses (app_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [appId, groupId],
    );
  }
  async candidates(groupId: string): Promise<readonly string[]> {
    const result = await this.query<{ app_id: string }>(
      `SELECT app_id FROM "${this.schema}".group_addresses WHERE group_id=$1 ORDER BY app_id`,
      [groupId],
    );
    return result.rows.map((row) => row.app_id);
  }
  async lookup(groupId: string): Promise<{ explicit?: string; candidates: readonly string[] }> {
    // One statement gives the preference and candidates a consistent snapshot and one network round trip.
    const result = await this.query<{ app_id: string; preferred: boolean }>(
      `SELECT a.app_id, (b.app_id IS NOT NULL) AS preferred FROM "${this.schema}".group_addresses a LEFT JOIN "${this.schema}".group_bindings b ON b.group_id=a.group_id AND b.app_id=a.app_id WHERE a.group_id=$1 ORDER BY a.app_id`,
      [groupId],
    );
    const explicit = result.rows.find((row) => row.preferred)?.app_id;
    return {
      candidates: result.rows.map((row) => row.app_id),
      ...(explicit === undefined ? {} : { explicit }),
    };
  }
  async bind(appId: string, groupId: string): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO "${this.schema}".group_addresses (app_id, group_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [appId, groupId],
      );
      await client.query(
        `INSERT INTO "${this.schema}".group_bindings (group_id, app_id) VALUES ($1,$2) ON CONFLICT (group_id) DO UPDATE SET app_id=EXCLUDED.app_id`,
        [groupId, appId],
      );
    });
  }
  async unbind(groupId: string): Promise<void> {
    await this.query(`DELETE FROM "${this.schema}".group_bindings WHERE group_id=$1`, [groupId]);
  }
  close(deadline: number): Promise<void> {
    this.closing ??= this.finish(deadline);
    return this.closing;
  }
  private async finish(deadline: number): Promise<void> {
    this.closed = true;
    const ending = this.pool.end();
    try {
      await bounded(ending, deadline, undefined, this.clock);
    } catch (error) {
      for (const client of [...this.borrowed]) client.release(true);
      for (const socket of this.sockets) socket.destroy();
      ending.catch(() => {});
      throw error;
    }
  }
}

/** Explicit, transactional, serialized migration. Application.start never creates or alters tables. */
export async function migrateDatabase(options: DatabaseOptions): Promise<void> {
  const settings = databaseSettings(options);
  const pool = new Pool(poolConfig(settings));
  pool.on('error', () => {});
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `dou-bot:${settings.schema}`,
    ]);
    const schema = `"${settings.schema}"`;
    await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${schema}.schema_version (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), version integer NOT NULL)`,
    );
    const version = await client.query<{ version: number }>(
      `SELECT version FROM ${schema}.schema_version WHERE singleton=true`,
    );
    if (version.rows.length && version.rows[0]?.version !== SCHEMA_VERSION)
      throw new FrameworkError('DATABASE_SCHEMA', 'Unsupported framework migration version');
    if (!version.rows.length) {
      await client.query(
        `CREATE TABLE ${schema}.bots (app_id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`,
      );
      await client.query(
        `CREATE TABLE ${schema}.group_addresses (app_id text NOT NULL REFERENCES ${schema}.bots(app_id), group_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(app_id,group_id))`,
      );
      await client.query(`CREATE INDEX ON ${schema}.group_addresses (group_id)`);
      await client.query(
        `CREATE TABLE ${schema}.group_bindings (group_id text PRIMARY KEY, app_id text NOT NULL, FOREIGN KEY(app_id,group_id) REFERENCES ${schema}.group_addresses(app_id,group_id))`,
      );
      await client.query(`INSERT INTO ${schema}.schema_version (version) VALUES ($1)`, [
        SCHEMA_VERSION,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof FrameworkError) throw error;
    throw new FrameworkError('DATABASE', 'Framework database migration failed', { cause: error });
  } finally {
    client?.release();
    await pool.end();
  }
}
