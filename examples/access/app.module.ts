import {
  Command,
  Controller,
  GroupManagersOnly,
  GroupOnly,
  GroupRoles,
  Module,
  PrivateOnly,
  UsersOnly,
} from 'dou-bot';

@Controller()
export class AccessController {
  @Command('group')
  @GroupOnly()
  group(): string {
    return '群聊允许。';
  }

  @Command('private')
  @PrivateOnly()
  privateMessage(): string {
    return '私聊允许。';
  }

  @Command('allowed')
  @UsersOnly(['USER_OPENID'], { scene: 'private' })
  allowed(): string {
    return '允许名单验证通过。';
  }

  @Command('owner')
  @GroupRoles('owner')
  owner(): string {
    return '当前发送者是群主。';
  }

  @Command('managers')
  @GroupManagersOnly()
  managers(): string {
    return '当前发送者是群主或管理员。';
  }
  // 群角色由 QQ 事件提供；缺失或未知角色不会被猜测成管理员。
}
@Module({ controllers: [AccessController] })
export class AppModule {}
