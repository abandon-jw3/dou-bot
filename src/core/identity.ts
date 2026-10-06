import type { GroupInfo, MessageTarget, UserInfo } from '../contracts.js';
import type { ParameterBinding } from './metadata.js';

export type IdentitySelection = 'user' | 'userId' | 'group' | 'groupId' | 'role';
export interface IdentitySnapshot {
  readonly user: UserInfo;
  readonly group?: GroupInfo;
}

/** Copy only normalized values before observers or guards can see the raw event. */
export function identitySnapshot(user: UserInfo, target: MessageTarget): IdentitySnapshot {
  return Object.freeze({
    user: Object.freeze({ ...user }),
    ...(target.scene === 'group' ? { group: Object.freeze({ id: target.groupId }) } : {}),
  });
}

/** Commands and buttons share this non-consuming, synchronous binding step. */
export function bindIdentity(
  bindings: readonly ParameterBinding[],
  values: unknown[],
  identity: IdentitySnapshot,
): void {
  for (const binding of bindings) {
    if (binding.kind !== 'identity') continue;
    switch (binding.selection) {
      case 'user':
        values[binding.index] = identity.user;
        break;
      case 'userId':
        values[binding.index] = identity.user.id;
        break;
      case 'group':
        values[binding.index] = identity.group;
        break;
      case 'groupId':
        values[binding.index] = identity.group?.id;
        break;
      case 'role':
        values[binding.index] = identity.user.memberRole;
        break;
    }
  }
}
