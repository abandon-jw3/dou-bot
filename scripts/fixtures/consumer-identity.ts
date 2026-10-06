import assert from 'node:assert/strict';
import {
  Command,
  Controller,
  Ctx,
  Group,
  GroupId,
  Module,
  OnButton,
  Role,
  User,
  UserId,
} from 'dou-bot';
import type { ButtonContext, GroupInfo, GroupRole, MessageContext, UserInfo } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

const seen: unknown[] = [];
function snapshot(
  user: UserInfo,
  userId: string,
  group: GroupInfo | undefined,
  groupId: string | undefined,
  role: GroupRole | undefined,
): void {
  assert.equal(user.id, userId);
  assert.equal(group?.id, groupId);
  assert.equal(user.memberRole, role);
  assert.ok(Object.isFrozen(user));
  assert.ok(group === undefined || Object.isFrozen(group));
  seen.push({ user, userId, group, groupId, role });
}
@Controller()
class IdentityCommands {
  @Command('identity') inspect(
    @User() user: UserInfo,
    @UserId() userId: string,
    @Group() group: GroupInfo | undefined,
    @GroupId() groupId: string | undefined,
    @Role() role: GroupRole | undefined,
    @Ctx() ctx: MessageContext,
  ): string {
    assert.equal(userId, ctx.userId);
    snapshot(user, userId, group, groupId, role);
    return 'identity accepted';
  }
  @OnButton('identity') async button(
    @Role() role: GroupRole | undefined,
    @GroupId() groupId: string | undefined,
    @Group() group: GroupInfo | undefined,
    @UserId() userId: string,
    @User() user: UserInfo,
    @Ctx() ctx: ButtonContext,
  ): Promise<void> {
    snapshot(user, userId, group, groupId, role);
    await ctx.ack();
  }
}
@Module({ controllers: [IdentityCommands] })
class Root {}
const harness = await createTestApplication(Root, { interactions: { acknowledge: 'manual' } });
await harness.app.start();
try {
  for (const scene of ['private', 'group']) {
    await harness.dispatch({
      op: 0,
      t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
      d: {
        id: `message-${scene}`,
        content: '/identity extra-legacy-argument',
        ...(scene === 'private'
          ? { author: { user_openid: 'user', username: '', bot: false, member_role: 'owner' } }
          : {
              group_openid: 'group',
              author: { member_openid: 'user', username: '群员', bot: false, member_role: 'admin' },
            }),
      },
    });
    await harness.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: `button-${scene}`,
        chat_type: scene === 'private' ? 2 : 1,
        ...(scene === 'private'
          ? { user_openid: 'user' }
          : { group_openid: 'group', group_member_openid: 'user' }),
        data: { resolved: { button_id: 'identity' } },
      },
    });
  }
  assert.deepEqual(seen, [
    {
      user: { id: 'user', username: '', bot: false },
      userId: 'user',
      group: undefined,
      groupId: undefined,
      role: undefined,
    },
    { user: { id: 'user' }, userId: 'user', group: undefined, groupId: undefined, role: undefined },
    {
      user: { id: 'user', username: '群员', bot: false, memberRole: 'admin' },
      userId: 'user',
      group: { id: 'group' },
      groupId: 'group',
      role: 'admin',
    },
    {
      user: { id: 'user' },
      userId: 'user',
      group: { id: 'group' },
      groupId: 'group',
      role: undefined,
    },
  ]);
  assert.deepEqual(
    harness.messages.map((entry) => entry.payload.content),
    ['identity accepted', 'identity accepted'],
  );
  assert.deepEqual(
    harness.acknowledgments.map((entry) => entry.code),
    [0, 0],
  );
  assert.deepEqual(harness.errors, []);
} finally {
  await harness.app.close();
}
console.log('Identity decorators verified for messages and buttons in the independent consumer.');
