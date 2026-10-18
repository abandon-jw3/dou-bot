import { GroupRoutes } from '../contracts.js';
import type { GroupTarget } from '../contracts.js';
import type { Persistence } from '../database/postgres.js';
import { FrameworkError } from './errors.js';
import { hasControlCharacters } from './utils.js';

export function addressId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 1024 ||
    hasControlCharacters(value)
  )
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid account or OpenID');
}
export class PersistentGroupRoutes extends GroupRoutes {
  private readonly observed = new Map<string, { promise: Promise<void>; ready: boolean }>();
  constructor(
    private readonly store: Persistence,
    private readonly configured: ReadonlySet<string>,
    private readonly available: () => boolean,
  ) {
    super();
  }
  private assertAvailable(): void {
    if (!this.available())
      throw new FrameworkError('INVALID_STATE', 'Group routes are not available');
  }
  hasObserved(appId: string, groupId: string): boolean {
    return this.observed.has(JSON.stringify([appId, groupId]));
  }
  hasLearned(appId: string, groupId: string): boolean {
    return this.observed.get(JSON.stringify([appId, groupId]))?.ready === true;
  }
  async observe(appId: string, groupId: string): Promise<void> {
    this.assertAvailable();
    addressId(appId);
    addressId(groupId);
    const key = JSON.stringify([appId, groupId]);
    const previous = this.observed.get(key);
    if (previous) return previous.promise;
    // Only successful writes are cached. Lookup/selection always consults PostgreSQL.
    const write = this.store.observe(appId, groupId);
    if (this.observed.size >= 10000) this.observed.delete(this.observed.keys().next().value!);
    const entry = { promise: write, ready: false };
    this.observed.set(key, entry);
    try {
      await write;
      entry.ready = true;
    } catch (error) {
      if (this.observed.get(key) === entry) this.observed.delete(key);
      throw error;
    }
  }
  override async list(groupId: string): Promise<readonly GroupTarget[]> {
    this.assertAvailable();
    addressId(groupId);
    return Object.freeze(
      (await this.store.candidates(groupId)).map((appId) =>
        Object.freeze({ scene: 'group' as const, appId, groupId }),
      ),
    );
  }
  override async resolve(groupId: string): Promise<GroupTarget> {
    this.assertAvailable();
    addressId(groupId);
    const { explicit: bound, candidates } = await this.store.lookup(groupId);
    if (bound !== undefined) return Object.freeze({ scene: 'group', appId: bound, groupId });
    if (!candidates.length)
      throw new FrameworkError('ROUTE_NOT_FOUND', 'No recorded bot address for this group OpenID');
    if (candidates.length !== 1)
      throw new FrameworkError(
        'ROUTE_AMBIGUOUS',
        'Group OpenID has multiple recorded accounts; specify appId or bind a route',
      );
    return Object.freeze({ scene: 'group', appId: candidates[0]!, groupId });
  }
  override async bind(target: GroupTarget): Promise<void> {
    this.assertAvailable();
    addressId(target.appId);
    addressId(target.groupId);
    if (target.scene !== 'group' || !this.configured.has(target.appId))
      throw new FrameworkError(
        'HANDLER_CONTRACT',
        'Binding requires a configured bot and group address',
      );
    await this.store.bind(target.appId, target.groupId);
  }
  override async unbind(groupId: string): Promise<void> {
    this.assertAvailable();
    addressId(groupId);
    await this.store.unbind(groupId);
  }
  clear(): void {
    this.observed.clear();
  }
}
