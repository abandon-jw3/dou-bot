import { Injectable } from 'dd-bot';
import type { CanActivate, GuardContext, GuardResult } from 'dd-bot';

// Guard 也是 Provider，使用 @Injectable 并在模块中注册。
// canActivate 在参数绑定和冷却之前执行；ctx 中还没有解析后的命令参数。
@Injectable()
export class GroupOnlyGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    // true 放行；{ allow: false, message } 拒绝并提示；false 表示静默拒绝。
    return ctx.scene === 'group' ? true : { allow: false, message: '此示例只能在群聊中使用。' };
  }
}

@Injectable()
export class PrivateOnlyGuard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    // Guard 返回决策即可；GuardContext 没有 reply/send 方法。
    return ctx.scene === 'private' ? true : { allow: false, message: '此示例只能在私聊中使用。' };
  }
}
