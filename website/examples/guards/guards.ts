import { Inject, Injectable } from 'dou-bot';
import type { CanActivate, GuardContext, GuardResult } from 'dou-bot';

export const ALLOWED_USERS = Symbol('allowed-users');
@Injectable()
export class GroupSceneGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.scene === 'group' || { allow: false, message: '请在群聊中使用。' };
  }
}
@Injectable()
export class AllowlistGuard implements CanActivate {
  constructor(@Inject(ALLOWED_USERS) private readonly users: readonly string[]) {}
  canActivate(ctx: GuardContext): GuardResult {
    // 群成员 OpenID 不等同于 QQ 号，也不应与私聊 OpenID 混用。
    return this.users.includes(ctx.userId) || { allow: false, message: '当前用户不在允许名单中。' };
  }
}
@Injectable()
export class OwnerGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return (
      (ctx.kind === 'command' && ctx.scene === 'group' && ctx.memberRole === 'owner') || {
        allow: false,
        message: '此操作需要当前群主身份。',
      }
    );
  }
}
