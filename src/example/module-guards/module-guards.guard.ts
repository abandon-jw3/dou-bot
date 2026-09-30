import { Injectable } from 'dou-bot';
import type { CanActivate, GuardContext, GuardResult } from 'dou-bot';

// 模块级 Guard：这个功能模块的所有命令都只能在群聊中使用。
// 注册到 providers 后，由 @Module({ guards: [...] }) 统一引用。
@Injectable()
export class ModuleGroupGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.scene === 'group' ? true : { allow: false, message: '模块级检查：请在群聊中使用。' };
  }
}

// 类级 Guard：在模块规则通过后，进一步限制管理控制器中的全部命令。
// 这里手写角色判断用于演示自定义 Guard，实际业务也可以使用 GroupManagersOnly。
@Injectable()
export class ControllerManagersGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.kind === 'command' &&
      ctx.scene === 'group' &&
      (ctx.memberRole === 'owner' || ctx.memberRole === 'admin')
      ? true
      : { allow: false, message: '类级检查：仅群主或管理员可用。' };
  }
}

// 方法级 Guard：只对标记了这个 Guard 的单条命令增加“仅群主”限制。
@Injectable()
export class MethodOwnerGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.kind === 'command' && ctx.scene === 'group' && ctx.memberRole === 'owner'
      ? true
      : { allow: false, message: '方法级检查：仅群主可用。' };
  }
}
