import type {
  AccessOptions,
  CanActivate,
  GroupRole,
  InjectionToken,
  UsersOnlyOptions,
} from '../contracts.js';
import { FrameworkError } from './errors.js';
import { isRecord } from './utils.js';

export type BuiltinGuard = Readonly<
  { message: string | false } & (
    | { kind: 'scene'; scene: 'group' | 'private' }
    | { kind: 'users'; userIds: readonly string[]; scene?: 'group' | 'private'; groupId?: string }
    | { kind: 'roles'; roles: readonly GroupRole[] }
  )
>;
export type GuardDeclaration = InjectionToken<CanActivate> | BuiltinGuard;

export function isGroupRole(value: unknown): value is GroupRole {
  return value === 'member' || value === 'admin' || value === 'owner';
}

function hint(options: AccessOptions, fallback: string, keys = ['message']): string | false {
  if (
    !isRecord(options) ||
    Object.keys(options).some((key) => !keys.includes(key)) ||
    (options.message !== undefined &&
      options.message !== false &&
      (typeof options.message !== 'string' || !options.message.trim()))
  )
    throw new FrameworkError('CONFIG', 'Invalid access options');
  return options.message ?? fallback;
}

export function sceneGuard(scene: 'group' | 'private', options: AccessOptions): BuiltinGuard {
  return Object.freeze({
    kind: 'scene',
    scene,
    message: hint(options, scene === 'group' ? '此操作仅限群聊。' : '此操作仅限私聊。'),
  });
}

export function usersGuard(userIds: readonly string[], options: UsersOnlyOptions): BuiltinGuard {
  const message = hint(options, '你没有使用此操作的权限。', ['message', 'scene', 'groupId']);
  if (
    !Array.isArray(userIds) ||
    !userIds.length ||
    !Array.from(userIds).every((id: unknown) => typeof id === 'string' && id.trim().length > 0) ||
    (options.scene !== undefined && options.scene !== 'group' && options.scene !== 'private') ||
    (options.groupId !== undefined &&
      (typeof options.groupId !== 'string' ||
        !options.groupId.trim() ||
        options.scene === 'private'))
  )
    throw new FrameworkError('CONFIG', 'UsersOnly requires nonempty OpenIDs and a valid scene');
  const scene = options.groupId === undefined ? options.scene : 'group';
  return Object.freeze({
    kind: 'users',
    userIds: Object.freeze([...new Set(userIds)]),
    message,
    ...(scene === undefined ? {} : { scene }),
    ...(options.groupId === undefined ? {} : { groupId: options.groupId }),
  });
}

export function rolesGuard(roles: readonly GroupRole[], options: AccessOptions = {}): BuiltinGuard {
  const message = hint(options, '此操作仅限群内指定角色，当前身份不符合要求或无法确认。');
  if (!roles.length || !roles.every(isGroupRole))
    throw new FrameworkError('CONFIG', 'GroupRoles requires member, admin or owner');
  return Object.freeze({ kind: 'roles', roles: Object.freeze([...new Set(roles)]), message });
}

export function isBuiltinGuard(guard: GuardDeclaration): guard is BuiltinGuard {
  return typeof guard === 'object';
}

// Built-ins use the same CanActivate/runGuard pipeline as user-defined providers.
export function createBuiltinGuard(rule: BuiltinGuard): CanActivate {
  const users = rule.kind === 'users' ? new Set(rule.userIds) : undefined;
  return {
    canActivate(ctx) {
      const allowed =
        rule.kind === 'scene'
          ? ctx.scene === rule.scene
          : rule.kind === 'users'
            ? users!.has(ctx.userId) &&
              (rule.scene === undefined || ctx.scene === rule.scene) &&
              (rule.groupId === undefined ||
                (ctx.scene === 'group' && ctx.groupId === rule.groupId))
            : ctx.kind === 'command' &&
              ctx.scene === 'group' &&
              ctx.memberRole !== undefined &&
              rule.roles.includes(ctx.memberRole);
      return allowed || (rule.message === false ? false : { allow: false, message: rule.message });
    },
  };
}

export function validateAccessRules(
  guards: readonly GuardDeclaration[],
  kind?: 'command' | 'button',
): void {
  let scene: 'group' | 'private' | undefined;
  let roles: readonly GroupRole[] = ['member', 'admin', 'owner'];
  for (const rule of guards) {
    if (!isBuiltinGuard(rule)) continue;
    if (rule.kind === 'roles') {
      if (kind === 'button')
        throw new FrameworkError(
          'CONFIG',
          'GroupRoles/GroupManagersOnly require @Command; use button permission for @OnButton',
        );
      roles = roles.filter((role) => rule.roles.includes(role));
      if (!roles.length) throw new FrameworkError('CONFIG', 'Conflicting group role restrictions');
    }
    const required = rule.kind === 'roles' ? 'group' : rule.scene;
    if (required !== undefined) {
      if (scene !== undefined && scene !== required)
        throw new FrameworkError('CONFIG', 'Conflicting group/private access restrictions');
      scene = required;
    }
  }
}
