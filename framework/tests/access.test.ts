import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  GroupManagersOnly,
  GroupOnly,
  GroupRoles,
  Injectable,
  Module,
  On,
  OnButton,
  PrivateOnly,
  Slot,
  UsersOnly,
  UseGuards,
} from '../src/index.js';
import type {
  AccessOptions,
  ButtonContext,
  CanActivate,
  GroupRole,
  GuardContext,
  MessageContext,
  QQDispatch,
  QQEventContext,
  Type,
  UsersOnlyOptions,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

let next = 0;
function message(
  content: string,
  role?: unknown,
  scene = 'group',
  user = 'u',
  group = 'g',
  at = false,
): QQDispatch {
  return {
    op: 0,
    t:
      scene === 'private'
        ? 'C2C_MESSAGE_CREATE'
        : at
          ? 'GROUP_AT_MESSAGE_CREATE'
          : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `access-${++next}`,
      content,
      author: {
        ...(scene === 'private' ? { user_openid: user } : { member_openid: user }),
        ...(role === undefined ? {} : { member_role: role }),
      },
      ...(scene === 'private' ? {} : { group_openid: group }),
    },
  };
}
function click(scene: 'group' | 'private', user = 'u'): QQDispatch {
  return {
    op: 0,
    t: 'INTERACTION_CREATE',
    d: {
      id: `access-click-${++next}`,
      chat_type: scene === 'group' ? 1 : 2,
      ...(scene === 'group'
        ? { group_openid: 'g', group_member_openid: user }
        : { user_openid: user }),
      data: { resolved: { button_id: 'test', button_data: '' } },
    },
  };
}
async function setup(t: TestContext, controller: Type, manual = false) {
  @Module({ controllers: [controller] })
  class Root {}
  const h = await createTestApplication(Root, {
    interactions: { acknowledge: manual ? 'manual' : 'auto' },
    commands: { invalidInput: 'reply' },
  });
  t.after(() => h.app.close());
  await h.app.start();
  return h;
}
const configError = (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG';

await test('group and private built-ins work without providers, with custom and silent denial', async (t) => {
  @Controller()
  class Commands {
    @GroupOnly({ message: 'group only' }) @Command('group') group() {
      return 'group';
    }
    @PrivateOnly({ message: false }) @Command('private') private() {
      return 'private';
    }
  }
  const h = await setup(t, Commands);
  await h.dispatch(message('/group'));
  await h.dispatch(message('/group', undefined, 'private'));
  await h.dispatch(message('/private'));
  await h.dispatch(message('/private', undefined, 'private'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['group', 'group only', 'private'],
  );
  assert.equal(h.errors.length, 0);
});

await test('only recognized current-author roles reach group message and guard contexts', async (t) => {
  const seen: unknown[] = [];
  @Injectable()
  class Capture implements CanActivate {
    canActivate(ctx: GuardContext) {
      seen.push(ctx.scene === 'group' ? ctx.memberRole : undefined);
      return true;
    }
  }
  @Controller()
  class Commands {
    @UseGuards(Capture) @Command('role') role(@Ctx() ctx: MessageContext) {
      return ctx.scene === 'group' ? (ctx.memberRole ?? 'unknown') : 'private';
    }
  }
  @Module({ controllers: [Commands], providers: [Capture] })
  class Root {}
  const h = await createTestApplication(Root);
  t.after(() => h.app.close());
  await h.app.start();
  for (const at of [false, true]) {
    for (const role of ['owner', 'admin', 'member', 'OWNER', '', 1, null, undefined])
      await h.dispatch(message('/role', role, 'group', 'u', 'g', at));
  }
  await h.dispatch(message('/role', 'owner', 'private'));
  const nested: QQDispatch = {
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: `nested-${++next}`,
      group_openid: 'g',
      author: { member_openid: 'u' },
      content: '/role',
      mentions: [{ member_role: 'owner' }],
      msg_elements: [{ author: { member_role: 'owner' } }],
    },
  };
  await h.dispatch(nested);
  const roles = ['owner', 'admin', 'member', undefined, undefined, undefined, undefined, undefined];
  assert.deepEqual(seen, [...roles, ...roles, undefined, undefined]);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    [...roles, ...roles].map((r) => r ?? 'unknown').concat(['private', 'unknown']),
  );
});

await test('GroupRoles matches any listed role; managers include owner and reject missing roles/private messages', async (t) => {
  @Controller()
  class Commands {
    @GroupRoles('owner') @Command('owner') owner() {
      return 'yes';
    }
    @GroupRoles('admin') @Command('admin') admin() {
      return 'yes';
    }
    @GroupRoles('member') @Command('member') member() {
      return 'yes';
    }
    @GroupRoles('owner', 'admin') @Command('roles') roles() {
      return 'yes';
    }
    @GroupManagersOnly() @Command('managers') managers() {
      return 'yes';
    }
  }
  const h = await setup(t, Commands);
  for (const [route, allowed] of [
    ['owner', ['owner']],
    ['admin', ['admin']],
    ['member', ['member']],
    ['roles', ['owner', 'admin']],
    ['managers', ['owner', 'admin']],
  ] as const) {
    for (const role of ['owner', 'admin', 'member', 'future', undefined]) {
      await h.dispatch(message(`/${route}`, role));
      assert.equal(
        h.messages.at(-1)?.payload.content === 'yes',
        (allowed as readonly unknown[]).includes(role),
      );
    }
    await h.dispatch(message(`/${route}`, 'owner', 'private'));
    assert.notEqual(h.messages.at(-1)?.payload.content, 'yes');
  }
  assert.equal(h.errors.length, 0);
});

await test('UsersOnly snapshots inputs, supports scene/group scope, and composes class/method allowlists', async (t) => {
  const users = ['u', 'v'];
  const options: UsersOnlyOptions = { scene: 'group', groupId: 'g', message: 'denied' };
  @Controller()
  @UsersOnly(users, options)
  class Commands {
    @UsersOnly(['u'], { message: 'method denied' }) @Command('users') users() {
      return 'yes';
    }
  }
  users.splice(0, users.length, 'intruder');
  options.scene = 'private';
  options.groupId = 'other';
  const h = await setup(t, Commands);
  await h.dispatch(message('/users'));
  await h.dispatch(message('/users', undefined, 'group', 'v'));
  await h.dispatch(message('/users', undefined, 'group', 'intruder'));
  await h.dispatch(message('/users', undefined, 'private'));
  await h.dispatch(message('/users', undefined, 'group', 'u', 'other'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['yes', 'method denied', 'denied', 'denied', 'denied'],
  );
});

await test('unscoped UsersOnly compares supplied OpenIDs without cross-scene identity conversion', async (t) => {
  @Controller()
  class Commands {
    @UsersOnly(['group-id', 'private-id']) @Command('users') users() {
      return 'yes';
    }
  }
  const h = await setup(t, Commands);
  await h.dispatch(message('/users', undefined, 'group', 'group-id'));
  await h.dispatch(message('/users', undefined, 'private', 'private-id'));
  await h.dispatch(message('/users', undefined, 'private', 'different-id'));
  assert.deepEqual(
    h.messages.slice(0, 2).map((m) => m.payload.content),
    ['yes', 'yes'],
  );
  assert.notEqual(h.messages[2]?.payload.content, 'yes');
});

await test('built-ins preserve class/method and user guard order; denials do not parse arguments or reserve cooldown', async (t) => {
  const calls: string[] = [];
  @Injectable()
  class Before implements CanActivate {
    canActivate() {
      calls.push('before');
      return true;
    }
  }
  @Injectable()
  class After implements CanActivate {
    canActivate() {
      calls.push('after');
      return true;
    }
  }
  @Controller()
  @UseGuards(Before)
  @GroupOnly({ message: 'group' })
  @UseGuards(After)
  class Commands {
    @Command('test')
    @GroupManagersOnly({ message: 'role' })
    @Cooldown({ scope: 'command', durationMs: 60000, message: 'cooldown' })
    query(
      @Slot('word', {
        choices: ['ok'],
        required: true,
        match: () => {
          calls.push('parse');
          return true;
        },
      })
      word: string,
    ) {
      return word;
    }
  }
  @Module({ controllers: [Commands], providers: [Before, After] })
  class Root {}
  const h = await createTestApplication(Root);
  t.after(() => h.app.close());
  await h.app.start();
  await h.dispatch(message('/test "broken', 'owner', 'private'));
  assert.deepEqual(calls, ['before']);
  await h.dispatch(message('/test ok', 'member'));
  assert.deepEqual(calls, ['before', 'before', 'after']);
  await h.dispatch(message('/test ok', 'owner'));
  await h.dispatch(message('/test ok', 'owner'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['group', 'role', 'ok', 'cooldown'],
  );
  assert.equal(h.errors.length, 0);
});

await test('class restrictions inherit, overridden methods replace method rules, observers remain independent', async (t) => {
  let observed = 0;
  @Controller()
  @GroupOnly({ message: 'group' })
  class Base {
    @Command('inherited') @GroupRoles('owner') inherited() {
      return 'owner';
    }
    @Command('override') @UsersOnly(['old']) replaced() {
      return 'old';
    }
    @Command('removed') @GroupRoles('owner') removed() {
      return 'old';
    }
    @On('C2C_MESSAGE_CREATE') observe(): void {
      observed++;
    }
  }
  @Controller()
  class Child extends Base {
    @Command('override') @UsersOnly(['u']) override replaced() {
      return 'new';
    }
    override removed() {
      return 'unregistered';
    }
  }
  const h = await setup(t, Child);
  await h.dispatch(message('/inherited', 'owner'));
  await h.dispatch(message('/override'));
  await h.dispatch(message('/override', undefined, 'private'));
  assert.equal(await h.dispatch(message('/removed')), 'ignored');
  assert.equal(observed, 1);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['owner', 'new', 'group'],
  );
});

await test('inconsistent scenes and roles reject at startup, including inherited and scoped rules', async () => {
  @Controller()
  @GroupOnly()
  class Base {
    @Command('x') x() {
      return 'x';
    }
  }
  @Controller()
  @PrivateOnly()
  class Inherited extends Base {}
  @Controller()
  @GroupOnly()
  class Mixed {
    @Command('x') @PrivateOnly() x() {}
  }
  @Controller()
  @PrivateOnly()
  class Roles {
    @Command('x') @GroupRoles('owner') x() {}
  }
  @Controller()
  @GroupRoles('owner')
  class RoleIntersection {
    @Command('x') @GroupRoles('admin') x() {}
  }
  @Controller()
  @GroupOnly()
  class Scoped {
    @Command('x') @UsersOnly(['u'], { scene: 'private' }) x() {}
  }
  for (const controller of [Inherited, Mixed, Roles, RoleIntersection, Scoped]) {
    @Module({ controllers: [controller] })
    class Root {}
    await assert.rejects(createTestApplication(Root), configError);
  }
});

await test('role restrictions on buttons and method restrictions on observers are configuration errors', async () => {
  @Controller()
  class Button {
    @OnButton('x') @GroupManagersOnly() x() {}
  }
  @Controller()
  @GroupRoles('owner')
  class ClassButton {
    @OnButton('x') x() {}
  }
  @Controller()
  class Observer {
    @On('EVENT') @GroupOnly() x() {}
  }
  @Controller()
  class Unregistered {
    @UsersOnly(['u']) x() {}
  }
  for (const controller of [Button, ClassButton, Observer, Unregistered]) {
    @Module({ controllers: [controller] })
    class Root {}
    await assert.rejects(createTestApplication(Root), configError);
  }
});

await test('malformed decorator arguments and targets fail during declaration', () => {
  for (const options of [null, { message: '' }, { message: true }, { extra: true }]) {
    for (const decorator of [GroupOnly, PrivateOnly, GroupManagersOnly])
      assert.throws(() => decorator(options as AccessOptions), configError);
  }
  for (const ids of [[], [''], [1], null, 'u', Array<string>(1)])
    assert.throws(() => UsersOnly(ids as string[]), configError);
  for (const options of [
    { scene: 'channel' },
    { groupId: '' },
    { scene: 'private', groupId: 'g' },
    { message: '' },
  ])
    assert.throws(() => UsersOnly(['u'], options as UsersOnlyOptions), configError);
  assert.throws(() => GroupRoles(), configError);
  assert.throws(() => GroupRoles('invalid' as GroupRole), configError);
  assert.throws(() => GroupOnly()({}, 'property', {}), configError);
});

await test('scene and user restrictions protect button callbacks and blocked manual callbacks still ACK', async (t) => {
  @Controller()
  @GroupOnly({ message: 'group' })
  class Buttons {
    @OnButton('test')
    @UsersOnly(['u'], { groupId: 'g', message: 'user' })
    async run(@Ctx() ctx: ButtonContext): Promise<void> {
      await ctx.ack();
      await ctx.send('yes');
    }
  }
  const h = await setup(t, Buttons, true);
  await h.dispatch(click('private'));
  await h.dispatch(click('group', 'other'));
  await h.dispatch(click('group'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['group', 'user', 'yes'],
  );
  assert.deepEqual(
    h.acknowledgments.map((a) => a.code),
    [0, 0, 0],
  );
  assert.equal(h.errors.length, 0);
});

await test('observers cannot change a normalized role by rewriting raw author data', async (t) => {
  @Controller()
  class Commands {
    @On('GROUP_MESSAGE_CREATE') rewrite(
      @Ctx() ctx: QQEventContext<{ author: { member_role: string } }>,
    ): void {
      ctx.raw.d.author.member_role = 'owner';
    }
    @Command('manage') @GroupManagersOnly({ message: 'denied' }) manage() {
      return 'yes';
    }
  }
  const h = await setup(t, Commands);
  await h.dispatch(message('/manage', 'member'));
  assert.equal(h.messages[0]?.payload.content, 'denied');
});
