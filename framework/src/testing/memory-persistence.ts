import { Pool } from 'pg';
import { Database } from '../contracts.js';
import type { Persistence } from '../database/postgres.js';
import { FrameworkError } from '../core/errors.js';
import type { QueryResult, QueryResultRow } from 'pg';

/** Test-only storage; never selected by AppFactory. SQL integration uses real PostgreSQL. */
export class MemoryPersistence implements Persistence {
  private readonly groups = new Map<string, Set<string>>();
  private readonly bindings = new Map<string, string>();
  readonly database = new (class extends Database {
    readonly pool = new Pool({
      host: '127.0.0.1',
      port: 1,
      user: 'offline',
      database: 'offline',
      password: () => '',
      options: '',
      ssl: false,
    });
    readonly schema = 'offline';
    query<R extends QueryResultRow = QueryResultRow>(): Promise<QueryResult<R>> {
      return Promise.reject(new FrameworkError('DATABASE', 'Offline storage does not execute SQL'));
    }
    transaction<T>(): Promise<T> {
      return Promise.reject(new FrameworkError('DATABASE', 'Offline storage does not execute SQL'));
    }
  })();
  open(): Promise<void> {
    return Promise.resolve();
  }
  registerBots(): Promise<void> {
    return Promise.resolve();
  }
  observe(appId: string, groupId: string): Promise<void> {
    const set = this.groups.get(groupId) ?? new Set();
    set.add(appId);
    this.groups.set(groupId, set);
    return Promise.resolve();
  }
  candidates(groupId: string): Promise<readonly string[]> {
    return Promise.resolve([...(this.groups.get(groupId) ?? [])].sort());
  }
  lookup(groupId: string): Promise<{ explicit?: string; candidates: readonly string[] }> {
    const explicit = this.bindings.get(groupId);
    return Promise.resolve({
      candidates: [...(this.groups.get(groupId) ?? [])].sort(),
      ...(explicit === undefined ? {} : { explicit }),
    });
  }
  async bind(appId: string, groupId: string): Promise<void> {
    await this.observe(appId, groupId);
    this.bindings.set(groupId, appId);
  }
  unbind(groupId: string): Promise<void> {
    this.bindings.delete(groupId);
    return Promise.resolve();
  }
  close(): Promise<void> {
    return this.database.pool.end();
  }
}
