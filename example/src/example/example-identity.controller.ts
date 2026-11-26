import {
  Command,
  Controller,
  Ctx,
  Group,
  GroupId,
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
export class ExampleIdentityController {
  @Command('example-identity', { description: '读取当前消息的用户、群和角色快照' })
  identity(
    @User() user: UserInfo,
    @UserId() userId: string,
    @Group() group: GroupInfo | undefined,
    @GroupId() groupId: string | undefined,
    @Role() role: GroupRole | undefined,
  ): string {
    // 这些 OpenID 属于当前场景，不是显示用的 QQ 号或群号；角色限制仍需 Guard。
    return [
      `用户：${userId}`,
      `用户名：${user.username === undefined ? '未提供' : JSON.stringify(user.username)}`,
      `机器人：${user.bot === undefined ? '未提供' : String(user.bot)}`,
      `群：${group?.id ?? groupId ?? '私聊'}`,
      `角色：${role ?? '未知或不适用'}`,
    ].join('\n');
  }

  @Command('example-identity-button', { description: '发送查看当前按钮操作者身份的按钮' })
  identityButton() {
    return markdown('点击按钮查看本次操作者的身份。', {
      keyboard: keyboard([[button.callback('example:identity', '查看身份', 'identity')]]),
    });
  }

  @OnButton('example:identity')
  async clicked(
    @UserId() userId: string,
    @GroupId() groupId: string | undefined,
    @Role() role: GroupRole | undefined,
    @Ctx() ctx: ButtonContext,
  ): Promise<void> {
    await ctx.ack();
    // 按钮事件不提供可信的群角色，不从权限或上一条消息推断。
    await ctx.send(
      `操作者：${userId}；群：${groupId ?? '私聊'}；角色：${role ?? '未知或不适用'}。`,
    );
  }
}
