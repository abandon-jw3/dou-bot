import {
  Command,
  Controller,
  Ctx,
  Group,
  GroupId,
  HelpModule,
  Module,
  OnButton,
  Role,
  User,
  UserId,
  button,
  keyboard,
  markdown,
} from 'dou-bot';
import type { ButtonContext, GroupInfo, GroupRole, UserInfo } from 'dou-bot';

@Controller()
class Identity {
  @Command('我是谁')
  who(
    @User() user: UserInfo,
    @UserId() userId: string,
    @Group() group: GroupInfo | undefined,
    @GroupId() groupId: string | undefined,
    @Role() role: GroupRole | undefined,
  ): string {
    return `用户：${user.username ?? userId}；群：${group?.id ?? groupId ?? '私聊'}；角色：${role ?? '未知或不适用'}。`;
  }

  @Command('身份按钮')
  button() {
    return markdown('点击查看本次操作者。', {
      keyboard: keyboard([[button.callback('who', '查看身份', 'identity')]]),
    });
  }

  @OnButton('who')
  async clicked(
    @UserId() userId: string,
    @GroupId() groupId: string | undefined,
    @Ctx() ctx: ButtonContext,
  ): Promise<void> {
    await ctx.ack();
    await ctx.send(`操作者：${userId}；群：${groupId ?? '私聊'}。`);
  }
}

@Module({ imports: [HelpModule], controllers: [Identity] })
export class AppModule {}
