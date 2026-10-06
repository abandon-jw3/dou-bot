import assert from 'node:assert/strict';
import test from 'node:test';
import type { TestContext } from 'node:test';
import {
  Arg,
  Args,
  Attachments,
  selectAttachments,
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  Group,
  GroupId,
  GroupOnly,
  GroupRoles,
  HelpModule,
  Images,
  Injectable,
  Module,
  On,
  OnButton,
  Option,
  Rest,
  Role,
  Slot,
  UseGuards,
  User,
  UserId,
} from '../src/index.js';
import type {
  Attachment,
  ButtonContext,
  CanActivate,
  GroupInfo,
  GroupRole,
  GuardResult,
  MessageContext,
  QQDispatch,
  QQEventContext,
  Type,
  UserInfo,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestOptions } from '../src/testing/index.js';
import { normalize } from '../src/qq/normalize.js';

let next = 0;
function message(
  content = '/identity',
  scene = 'group',
  extra: Record<string, unknown> = {},
): QQDispatch {
  return {
    op: 0,
    t:
      scene === 'private'
        ? 'C2C_MESSAGE_CREATE'
        : scene === 'mentioned'
          ? 'GROUP_AT_MESSAGE_CREATE'
          : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `identity-message-${++next}`,
      content,
      ...(scene === 'private'
        ? { author: { user_openid: 'user' } }
        : {
            group_openid: 'group',
            author: { member_openid: 'user' },
          }),
      ...extra,
    },
  };
}
function click(scene = 'group', extra: Record<string, unknown> = {}): QQDispatch {
  return {
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: `identity-button-${++next}`,
      chat_type: scene === 'group' ? 1 : 2,
      ...(scene === 'group'
        ? { group_openid: 'group', group_member_openid: 'user' }
        : { user_openid: 'user' }),
      data: { resolved: { button_id: 'identity', button_data: 'value', user_id: 'fallback' } },
      ...extra,
    },
  };
}
async function open(t: TestContext, controller: Type, options: TestOptions = {}) {
  @Module({ imports: [HelpModule], controllers: [controller] })
  class Root {}
  const harness = await createTestApplication(Root, options);
  t.after(() => harness.app.close());
  await harness.app.start();
  return harness;
}
function configError(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === 'CONFIG';
}

await test('identity decorators inject current private/group/mentioned senders and all recognized roles', async (t) => {
  const seen: unknown[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @Role() role: GroupRole | undefined,
      @UserId() userId: string,
      @Group() group: GroupInfo | undefined,
      @User() user: UserInfo,
      @GroupId() groupId: string | undefined,
      @Ctx() ctx: MessageContext,
    ): void {
      assert.equal(userId, ctx.userId);
      assert.equal(user.id, userId);
      assert.equal(group?.id, groupId);
      assert.equal(groupId, ctx.scene === 'group' ? ctx.groupId : undefined);
      assert.equal(role, ctx.scene === 'group' ? ctx.memberRole : undefined);
      assert.equal(user.memberRole, role);
      assert.equal('user' in ctx, false);
      assert.equal('group' in ctx, false);
      seen.push({ user, group, role });
    }
  }
  const harness = await open(t, Inspect);
  await harness.dispatch(
    message('/identity', 'private', {
      author: { user_openid: 'private-user', username: '', bot: false, member_role: 'owner' },
      group_openid: 'ignored-private-group',
    }),
  );
  for (const scene of ['group', 'mentioned']) {
    for (const member_role of ['member', 'admin', 'owner']) {
      await harness.dispatch(
        message(scene === 'mentioned' ? '<@self> /identity' : '/identity', scene, {
          author: { member_openid: 'user', username: '小明', bot: true, member_role },
          mentions: [{ id: 'self', is_you: true }],
        }),
      );
    }
  }
  assert.deepEqual(seen, [
    { user: { id: 'private-user', username: '', bot: false }, group: undefined, role: undefined },
    ...Array.from({ length: 2 }, () =>
      ['member', 'admin', 'owner'].map((role) => ({
        user: { id: 'user', username: '小明', bot: true, memberRole: role },
        group: { id: 'group' },
        role,
      })),
    ).flat(),
  ]);
  assert.deepEqual(harness.errors, []);
});

await test('identity snapshots preserve ID precedence, alias fallback and conflict diagnostics', async (t) => {
  const ids: unknown[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @GroupId() groupId: string | undefined,
    ): void {
      ids.push([user.id, groupId]);
    }
  }
  const harness = await open(t, Inspect);
  const group = message('/identity', 'group', {
    group_id: 'preferred-group',
    group_openid: 'alias-group',
    author: { id: 'preferred-user', member_openid: 'alias-user' },
  });
  const privateMessage = message('/identity', 'private', {
    author: { id: 'preferred-private', user_openid: 'alias-private' },
  });
  const normalized = normalize(group);
  assert.ok(normalized.status === 'ok');
  assert.deepEqual(normalized.conflictingFields, [
    'author.id/member_openid',
    'group_id/group_openid',
  ]);
  const normalizedPrivate = normalize(privateMessage);
  assert.ok(normalizedPrivate.status === 'ok');
  assert.deepEqual(normalizedPrivate.conflictingFields, ['author.id/user_openid']);
  await harness.dispatch(group);
  await harness.dispatch(privateMessage);
  await harness.dispatch(
    message('/identity', 'group', {
      group_id: '',
      author: { id: '', member_openid: 'alias-user' },
    }),
  );
  await harness.dispatch(
    message('/identity', 'private', { author: { id: 123, user_openid: 'alias-private' } }),
  );
  assert.deepEqual(ids, [
    ['preferred-user', 'preferred-group'],
    ['preferred-private', undefined],
    ['alias-user', 'group'],
    ['alias-private', undefined],
  ]);
  assert.deepEqual(harness.errors, []);
});

await test('missing, invalid and unknown optional author fields are omitted without rejecting the command', async (t) => {
  const users: UserInfo[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @Role() role: GroupRole | undefined,
    ): void {
      assert.equal(role, undefined);
      users.push(user);
    }
  }
  const harness = await open(t, Inspect);
  for (const fields of [
    {},
    { username: 1, bot: 'false', member_role: 'OWNER' },
    { username: null, bot: 0, member_role: 'superuser' },
    { username: '', bot: false },
    { username: 'user name', bot: true, member_role: 1 },
  ])
    await harness.dispatch(
      message('/identity', 'group', { author: { member_openid: 'user', ...fields } }),
    );
  assert.deepEqual(users, [
    { id: 'user' },
    { id: 'user' },
    { id: 'user' },
    { id: 'user', username: '', bot: false },
    { id: 'user', username: 'user name', bot: true },
  ]);
  assert.deepEqual(harness.errors, []);
});

await test('button operators use event IDs or resolved fallback and never inherit profiles or roles', async (t) => {
  const seen: unknown[] = [];
  @Controller()
  class Inspect {
    @Command('identity') remember(@Role() role: GroupRole | undefined): void {
      assert.equal(role, 'owner');
    }
    @OnButton('identity') async inspect(
      @User() user: UserInfo,
      @GroupId() groupId: string | undefined,
      @Role() role: GroupRole | undefined,
      @UserId() userId: string,
      @Ctx() ctx: ButtonContext,
      @Group() group: GroupInfo | undefined,
    ): Promise<void> {
      assert.equal(userId, ctx.userId);
      assert.equal(groupId, ctx.target.scene === 'group' ? ctx.target.groupId : undefined);
      assert.equal(role, undefined);
      assert.deepEqual(user, { id: userId });
      seen.push([userId, group]);
      await ctx.ack();
    }
  }
  for (const acknowledge of ['auto', 'manual'] as const) {
    const harness = await open(t, Inspect, { interactions: { acknowledge } });
    await harness.dispatch(
      message('/identity', 'group', { author: { member_openid: 'user', member_role: 'owner' } }),
    );
    for (const scene of ['group', 'private']) {
      await harness.dispatch(
        click(scene, {
          author: { id: 'spoofed', username: 'wrong', bot: true, member_role: 'owner' },
          member_role: 'owner',
          permission: { type: 1 },
        }),
      );
      await harness.dispatch(click(scene, { user_openid: '', group_member_openid: '' }));
    }
    assert.deepEqual(
      harness.acknowledgments.map((entry) => entry.code),
      [0, 0, 0, 0],
    );
    assert.deepEqual(harness.errors, []);
  }
  assert.deepEqual(
    seen,
    Array.from({ length: 2 }, () => [
      ['user', { id: 'group' }],
      ['fallback', { id: 'group' }],
      ['user', undefined],
      ['fallback', undefined],
    ]).flat(),
  );
});

await test('identity profiles exclude mentions, quoted authors and unrequested platform fields', async (t) => {
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @Group() group: GroupInfo | undefined,
    ): void {
      assert.deepEqual(user, { id: 'user' });
      assert.deepEqual(group, { id: 'group' });
    }
  }
  const harness = await open(t, Inspect);
  const other = { id: 'other', username: 'nested', bot: true, member_role: 'owner' };
  await harness.dispatch(
    message('/identity', 'group', {
      author: {
        member_openid: 'user',
        union_openid: 'union',
        union_user_account: 'account',
        avatar: 'avatar-url',
      },
      mentions: [other],
      msg_elements: [{ author: other, group_id: 'nested-group' }],
      ark_data: { fields: { nickname: 'card', avatar: 'card-url' } },
      group_name: 'not-a-profile',
    }),
  );
  assert.deepEqual(harness.errors, []);
});

await test('raw observers cannot rewrite normalized command or button identities', async (t) => {
  const seen: unknown[] = [];
  @Controller()
  class Inspect {
    @On('GROUP_MESSAGE_CREATE') rewriteMessage(
      @Ctx() ctx: QQEventContext<{ author: Record<string, unknown>; group_openid: string }>,
    ): void {
      Object.assign(ctx.raw.d.author, {
        id: 'changed',
        username: 'changed',
        bot: true,
        member_role: 'owner',
      });
      ctx.raw.d.group_openid = 'changed-group';
    }
    @On('INTERACTION_CREATE') rewriteButton(
      @Ctx() ctx: QQEventContext<Record<string, unknown>>,
    ): void {
      ctx.raw.d.group_member_openid = 'changed';
      ctx.raw.d.group_openid = 'changed-group';
    }
    @Command('identity') @GroupRoles('member') inspect(
      @User() user: UserInfo,
      @Group() group: GroupInfo | undefined,
      @Role() role: GroupRole | undefined,
    ): void {
      seen.push({ user, group, role });
    }
    @OnButton('identity') button(
      @User() user: UserInfo,
      @Group() group: GroupInfo | undefined,
      @Role() role: GroupRole | undefined,
    ): void {
      seen.push({ user, group, role });
    }
  }
  const harness = await open(t, Inspect);
  await harness.dispatch(
    message('/identity', 'group', {
      author: {
        member_openid: 'user',
        username: 'original',
        bot: false,
        member_role: 'member',
      },
    }),
  );
  await harness.dispatch(click());
  assert.deepEqual(seen, [
    {
      user: { id: 'user', username: 'original', bot: false, memberRole: 'member' },
      group: { id: 'group' },
      role: 'member',
    },
    { user: { id: 'user' }, group: { id: 'group' }, role: undefined },
  ]);
  assert.deepEqual(harness.errors, []);
});

await test('identity snapshots are frozen, shared within an event and isolated across events', async (t) => {
  const seen: { user: UserInfo; group: GroupInfo }[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @User() sameUser: UserInfo,
      @Group() group: GroupInfo | undefined,
      @Group() sameGroup: GroupInfo | undefined,
    ): void {
      assert.ok(group);
      assert.equal(user, sameUser);
      assert.equal(group, sameGroup);
      assert.ok(Object.isFrozen(user));
      assert.ok(Object.isFrozen(group));
      assert.throws(() => Object.assign(user, { id: 'changed' }), TypeError);
      assert.throws(() => Object.assign(group, { id: 'changed' }), TypeError);
      seen.push({ user, group });
    }
  }
  const harness = await open(t, Inspect);
  await harness.dispatch(message());
  await harness.dispatch(message());
  assert.equal(seen.length, 2);
  assert.notEqual(seen[0]?.user, seen[1]?.user);
  assert.notEqual(seen[0]?.group, seen[1]?.group);
  assert.deepEqual(harness.errors, []);
});

await test('identity bindings preserve legacy defaults, argument order and extra text', async (t) => {
  const seen: unknown[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @UserId() userId: string,
      @Args() args: string[],
      @Role() role: GroupRole | undefined,
      @Arg(0) first = 'fallback',
      @GroupId() groupId: string | undefined,
    ): void {
      seen.push({ userId, args, first, role, groupId });
    }
    @Command('only') only(@User() user: UserInfo): string {
      return user.id;
    }
  }
  const harness = await open(t, Inspect);
  await harness.dispatch(message('/identity --unknown extra tail', 'private'));
  await harness.dispatch(message('/identity', 'private'));
  await harness.dispatch(message('/only --unknown extra', 'private'));
  assert.deepEqual(seen, [
    {
      userId: 'user',
      args: ['--unknown', 'extra', 'tail'],
      first: '--unknown',
      role: undefined,
      groupId: undefined,
    },
    { userId: 'user', args: [], first: 'fallback', role: undefined, groupId: undefined },
  ]);
  assert.equal(harness.messages[0]?.payload.content, 'user');
  assert.deepEqual(harness.errors, []);
});

await test('identities coexist with every structured and attachment binding without changing error order', async (t) => {
  const seen: unknown[] = [];
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @Rest() rest: string[],
      @GroupId() groupId: string | undefined,
      @Slot('city', { choices: ['北京', '上海'], required: true }) city: string,
      @Arg(0, { required: true }) name: string,
      @Role() role: GroupRole | undefined,
      @Option('detail', { type: 'boolean', default: false }) detail: boolean,
      @Group() group: GroupInfo | undefined,
      @UserId() userId: string,
      @Attachments() all: readonly Attachment[],
    ): void {
      const counts = (['video', 'audio', 'file'] as const).map((kind) => {
        const result = selectAttachments(all, { kind });
        assert.ok(result.status === 'valid');
        return result.attachments.length;
      });
      seen.push({
        user,
        group,
        role,
        userId,
        groupId,
        rest,
        city,
        name,
        detail,
        counts: [all.length, images.length, ...counts],
      });
    }
  }
  const harness = await open(t, Inspect, { commands: { invalidInput: 'reply' } });
  for (const content of [
    '/identity --unknown',
    '/identity',
    '/identity label 北京 上海',
    '/identity label 北京 --detail=bad',
  ]) {
    await harness.dispatch(message(content));
  }
  await harness.dispatch(message('/identity label 北京'));
  await harness.dispatch(
    message('/identity label note 北京 --detail', 'group', {
      author: { member_openid: 'user', member_role: 'admin' },
      attachments: ['image/png', 'video/mp4', 'voice', 'file'].map((content_type) => ({
        url: 'https://example.invalid/file',
        content_type,
      })),
    }),
  );
  assert.equal(harness.errors.length, 5);
  for (const entry of harness.errors.slice(0, 4))
    assert.doesNotMatch(entry.error.message, /图片数量/u);
  assert.match(harness.errors[4]?.error.message ?? '', /图片数量/u);
  assert.deepEqual(seen, [
    {
      user: { id: 'user', memberRole: 'admin' },
      group: { id: 'group' },
      role: 'admin',
      userId: 'user',
      groupId: 'group',
      rest: ['note'],
      city: '北京',
      name: 'label',
      detail: true,
      counts: [4, 1, 1, 1, 1],
    },
  ]);
});

await test('guards, text errors, attachment errors and alias cooldown keep their order with identities', async (t) => {
  let allow = false;
  let calls = 0;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(): GuardResult {
      return allow || { allow: false, message: 'guard denied' };
    }
  }
  @Controller()
  class Inspect {
    @Command('identity', { aliases: ['again'] })
    @UseGuards(Gate)
    @Cooldown({ scope: 'user', durationMs: 60000, message: 'cooldown' })
    inspect(
      @Group() group: GroupInfo | undefined,
      @UserId() userId: string,
      @Arg(0, { required: true }) text: string,
      @Images({ minCount: 1 }) images: readonly Attachment[],
      @Role() role: GroupRole | undefined,
    ): string {
      calls++;
      assert.equal(group, undefined);
      assert.equal(role, undefined);
      return `${userId}:${text}:${images.length}`;
    }
  }
  @Module({ controllers: [Inspect], providers: [Gate] })
  class Root {}
  const harness = await createTestApplication(Root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  await harness.dispatch(message('/identity', 'private'));
  assert.equal(harness.messages[0]?.payload.content, 'guard denied');
  assert.equal(harness.errors.length, 0);
  allow = true;
  await harness.dispatch(message('/identity', 'private'));
  await harness.dispatch(message('/identity label', 'private'));
  const input = {
    attachments: [{ url: 'https://example.invalid/image', content_type: 'image/png' }],
  };
  await harness.dispatch(message('/identity label', 'private', input));
  await harness.dispatch(message('/again label', 'private', input));
  assert.equal(calls, 1);
  assert.equal(harness.errors.length, 2);
  assert.equal(harness.messages[3]?.payload.content, 'user:label:1');
  assert.equal(harness.messages[4]?.payload.content, 'cooldown');
});

await test('button identity injection retains auto/manual acknowledgment, guards and cooldown', async (t) => {
  for (const acknowledge of ['auto', 'manual'] as const) {
    let calls = 0;
    @Controller()
    class Inspect {
      @OnButton('identity')
      @GroupOnly({ message: 'group only' })
      @Cooldown({ scope: 'user', durationMs: 60000, message: 'cooldown' })
      async inspect(
        @Group() group: GroupInfo | undefined,
        @UserId() userId: string,
        @Role() role: GroupRole | undefined,
        @Ctx() ctx: ButtonContext,
      ): Promise<void> {
        calls++;
        assert.equal(role, undefined);
        await ctx.ack();
        await ctx.send(`${group?.id}:${userId}`);
      }
    }
    const harness = await open(t, Inspect, { interactions: { acknowledge } });
    await harness.dispatch(click('private'));
    await harness.dispatch(click('group'));
    await harness.dispatch(click('group'));
    assert.equal(calls, 1);
    assert.deepEqual(
      harness.messages.map((entry) => entry.payload.content),
      ['group only', 'group:user', 'cooldown'],
    );
    assert.deepEqual(
      harness.acknowledgments.map((entry) => entry.code),
      [0, 0, 0],
    );
    assert.deepEqual(harness.errors, []);
  }
});

await test('identity parameters do not appear in help or impose implicit group/role access', async (t) => {
  @Controller()
  class Inspect {
    @Command('identity') inspect(
      @User() user: UserInfo,
      @UserId() userId: string,
      @Group() group: GroupInfo | undefined,
      @GroupId() groupId: string | undefined,
      @Role() role: GroupRole | undefined,
    ): string {
      assert.deepEqual(user, { id: 'user' });
      assert.equal(group, undefined);
      assert.equal(groupId, undefined);
      assert.equal(role, undefined);
      return userId;
    }
    @Command('restricted')
    @GroupOnly({ message: 'group only' })
    restricted(@GroupId() id: string | undefined): string {
      return id ?? 'unexpected';
    }
  }
  const harness = await open(t, Inspect);
  await harness.dispatch(message('/help identity', 'private'));
  assert.equal(harness.messages[0]?.payload.content, '用法：/identity');
  await harness.dispatch(message('/identity', 'private'));
  await harness.dispatch(message('/restricted', 'private'));
  assert.deepEqual(
    harness.messages.slice(1).map((entry) => entry.payload.content),
    ['user', 'group only'],
  );
  assert.deepEqual(harness.errors, []);
});

await test('identity decorators reject raw events, unregistered methods, constructors, static methods and duplicate sources', async () => {
  let constructed = 0;
  for (const factory of [User, UserId, Group, GroupId, Role]) {
    for (const route of [On('C2C_MESSAGE_CREATE'), undefined]) {
      @Controller()
      class Invalid {
        constructor() {
          constructed++;
        }
        inspect(@factory() value: unknown): void {
          void value;
        }
      }
      if (route)
        route(
          Invalid.prototype,
          'inspect',
          Object.getOwnPropertyDescriptor(Invalid.prototype, 'inspect')!,
        );
      @Module({ controllers: [Invalid] })
      class Root {}
      await assert.rejects(createTestApplication(Root), configError);
    }
    assert.throws(() => factory()(class Constructor {}, undefined, 0), configError);
    assert.throws(() => factory()(class Static {}, 'inspect', 0), configError);
    assert.throws(() => factory()({}, Symbol('inspect'), 0), configError);
    for (const other of [Ctx, Images, UserId, factory]) {
      const target = {};
      other()(target, 'inspect', 0);
      assert.throws(() => factory()(target, 'inspect', 0), configError);
    }
  }
  assert.equal(constructed, 0);
});

await test('identity bindings follow inherited and overridden command/button registrations', async (t) => {
  @Controller()
  class Base {
    @Command('identity') inspect(@UserId() userId: string): string {
      return `base:${userId}`;
    }
    @OnButton('identity') async button(
      @Ctx() ctx: ButtonContext,
      @GroupId() groupId: string | undefined,
    ): Promise<void> {
      await ctx.send(groupId ?? 'private');
    }
  }
  @Controller()
  class Inherited extends Base {}
  @Controller()
  class Replaced extends Base {
    @Command('replacement') override inspect(@UserId() userId: string): string {
      return `new:${userId}`;
    }
    override button(_ctx: ButtonContext, _groupId: string | undefined): Promise<void> {
      void [_ctx, _groupId];
      assert.fail('Undecorated override must not inherit a route');
    }
  }
  const inherited = await open(t, Inherited);
  await inherited.dispatch(message());
  await inherited.dispatch(click());
  assert.deepEqual(
    inherited.messages.map((entry) => entry.payload.content),
    ['base:user', 'group'],
  );
  const replaced = await open(t, Replaced);
  assert.equal(await replaced.dispatch(message()), 'ignored');
  // Unhandled interactions still receive the existing automatic receipt acknowledgment.
  assert.equal(await replaced.dispatch(click()), 'accepted');
  assert.deepEqual(
    replaced.acknowledgments.map((entry) => entry.code),
    [0],
  );
  assert.equal(replaced.messages.length, 0);
  await replaced.dispatch(message('/replacement'));
  assert.equal(replaced.messages[0]?.payload.content, 'new:user');
  assert.deepEqual(inherited.errors, []);
  assert.deepEqual(replaced.errors, []);
});
