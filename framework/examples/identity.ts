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
} from '../src/index.js';
import type { ButtonContext, GroupInfo, GroupRole, UserInfo } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

// Unreleased source API. All identities below are local fixtures, not real QQ accounts.
@Controller()
class IdentityCommands {
  @Command('我', { description: '查看本条消息提供的身份信息' })
  me(
    @User() user: UserInfo,
    @Group() group: GroupInfo | undefined,
    @Role() role: GroupRole | undefined,
  ): string {
    return `用户：${user.username || user.id}；群：${group?.id ?? '私聊'}；角色：${role ?? '未知或不适用'}。`;
  }
  @OnButton('who') async who(
    @UserId() userId: string,
    @GroupId() groupId: string | undefined,
    @Role() role: GroupRole | undefined,
    @Ctx() ctx: ButtonContext,
  ): Promise<void> {
    await ctx.ack();
    await ctx.send(
      `操作者：${userId}；群：${groupId ?? '私聊'}；角色：${role ?? '未知或不适用'}。`,
    );
  }
}
@Module({ imports: [HelpModule], controllers: [IdentityCommands] })
class Root {}

const harness = await createTestApplication(Root, { interactions: { acknowledge: 'manual' } });
try {
  await harness.app.start();
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'private',
      author: { user_openid: 'private-user', username: '', bot: false },
      content: '/我',
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'group',
      group_openid: 'demo-group',
      author: { member_openid: 'group-user', username: '小明', member_role: 'admin' },
      content: '/我',
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: 'button',
      chat_type: 1,
      group_openid: 'demo-group',
      group_member_openid: 'group-user',
      data: { resolved: { button_id: 'who' } },
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'help', author: { user_openid: 'private-user' }, content: '/help 我' },
  });
  for (const entry of harness.messages)
    console.log(`${entry.target.scene}: ${entry.payload.content ?? ''}`);
  const failure = harness.errors[0];
  if (failure) throw failure.error;
} finally {
  await harness.app.close();
}
