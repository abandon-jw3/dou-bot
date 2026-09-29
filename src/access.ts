import { Command, Controller, Ctx, Inject, Injectable } from 'dd-bot';
import type { CanActivate, GuardContext, GuardResult, MessageContext, MessageTarget } from 'dd-bot';
import { AUDIT, CONFIG } from './config.js';
import type { AppConfig, Audit } from './config.js';

export interface Actor {
  readonly userId: string;
  readonly target: MessageTarget;
}
export function actorKey(actor: Actor): string {
  return JSON.stringify([
    actor.target.scene,
    actor.target.scene === 'group' ? actor.target.groupId : actor.target.userId,
    actor.userId,
  ]);
}

@Injectable()
export class AccessService {
  private readonly enrolled = new Map<'group' | 'private', string>();
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(AUDIT) private readonly audit: Audit,
  ) {}
  allowed(actor: Actor): boolean {
    if (this.config.liveEnrollment)
      return this.enrolled.get(actor.target.scene) === actorKey(actor);
    return actor.target.scene === 'private'
      ? this.config.privateUsers.includes(actor.userId)
      : this.config.groups.includes(actor.target.groupId);
  }
  enroll(actor: Actor): boolean {
    if (!this.config.liveEnrollment) return false;
    const scene = actor.target.scene;
    const key = actorKey(actor);
    if (this.enrolled.has(scene)) return this.enrolled.get(scene) === key;
    this.enrolled.set(scene, key);
    this.audit({ event: 'enrolled', scene });
    return true;
  }
  onModuleDestroy(): void {
    this.enrolled.clear();
  }
}

@Injectable()
export class WeatherGuard implements CanActivate {
  constructor(
    private readonly access: AccessService,
    @Inject(AUDIT) private readonly audit: Audit,
  ) {}
  canActivate(ctx: GuardContext): GuardResult {
    if (this.access.allowed(ctx)) return true;
    this.audit({ event: 'access-denied', scene: ctx.scene });
    return { allow: false, message: '此会话尚未获准使用天气查询。' };
  }
}

@Controller()
export class EnrollmentController {
  constructor(private readonly access: AccessService) {}
  @Command('启用', { description: '仅在本轮有随机前缀的实机验证窗口中临时启用会话' })
  enroll(@Ctx() ctx: MessageContext): string {
    return this.access.enroll(ctx)
      ? '本轮天气查询已启用，可以发送查询命令。'
      : '这个测试名额已经绑定其他用户或会话。';
  }
}
