import { Inject, Injectable } from '../../src/index.js';
import type { GuardContext } from '../../src/index.js';

export const QUERY_ACCESS = Symbol('query access');
export interface QueryAccess {
  privateUsers: readonly string[];
  groups: readonly { groupId: string; userIds: readonly string[] }[];
}

@Injectable()
export class PermissionService {
  private readonly privateUsers: ReadonlySet<string>;
  private readonly groups: ReadonlyMap<string, ReadonlySet<string>>;
  constructor(@Inject(QUERY_ACCESS) access: QueryAccess) {
    this.privateUsers = new Set(access.privateUsers);
    this.groups = new Map(access.groups.map((group) => [group.groupId, new Set(group.userIds)]));
  }
  canQuery(ctx: GuardContext): boolean {
    return ctx.scene === 'private'
      ? this.privateUsers.has(ctx.userId)
      : this.groups.get(ctx.groupId)?.has(ctx.userId) === true;
  }
}
