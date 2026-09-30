import { Command, Controller, Cooldown, Module, UseGuards } from 'dou-bot';
import { ALLOWED_USERS, AllowlistGuard, GroupSceneGuard, OwnerGuard } from './guards.js';

@Controller()
class InfoController {
  @Command('info') info(): string {
    return '已通过模块级群聊检查。';
  }
}
@Controller()
@UseGuards(AllowlistGuard) // 此控制器全部命令额外检查允许名单。
class SettingsController {
  @Command('settings') view(): string {
    return '已通过模块和类级检查。';
  }
  @Command('change')
  @UseGuards(OwnerGuard) // 本方法再检查群主；规则累加，不覆盖前两级。
  change(): string {
    return '已通过三级检查；本示例不执行真实管理操作。';
  }

  @Command('limited', { aliases: ['limited-alias'] })
  @Cooldown({ scope: 'user', durationMs: 3000, message: '请稍后再试。' })
  limited(): string {
    return '本次允许调用。';
  }
}
@Module({
  controllers: [InfoController, SettingsController],
  providers: [
    GroupSceneGuard,
    AllowlistGuard,
    OwnerGuard,
    { provide: ALLOWED_USERS, useValue: ['USER_OPENID'] },
  ], // 使用前替换为自己的群成员 OpenID。
  guards: [GroupSceneGuard], // 仅保护本模块直接注册的控制器，不传播到 imports。
})
export class AppModule {}
