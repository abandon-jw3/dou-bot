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
  HelpModule,
  Inject,
  Injectable,
  Module,
  On,
  OnButton,
  PrivateOnly,
  Slot,
  UseGuards,
} from '../src/index.js';
import type {
  ButtonContext,
  CanActivate,
  GuardContext,
  GuardResult,
  ModuleMetadata,
  QQDispatch,
  Type,
} from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

let next = 0;
function message(content: string, user = 'u', group?: string): QQDispatch {
  return {
    op: 0,
    t: group === undefined ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `module-guard-${++next}`,
      content,
      ...(group === undefined
        ? { author: { user_openid: user } }
        : { group_openid: group, author: { member_openid: user } }),
    },
  };
}
async function start(t: TestContext, root: Type, manual = false) {
  const h = await createTestApplication(root, {
    commands: { invalidInput: 'reply' },
    interactions: { acknowledge: manual ? 'manual' : 'auto' },
  });
  t.after(() => h.app.close());
  await h.app.start();
  return h;
}
const configError = (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG';

await test('module guards cover every own controller and run before class, method, parsing and cooldown', async (t) => {
  const calls: string[] = [];
  let allowed = false;
  @Injectable()
  class ModuleGate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      calls.push(`module:${ctx.route}`);
      return allowed || { allow: false, message: 'module denied' };
    }
  }
  @Injectable()
  class ClassGate implements CanActivate {
    canActivate() {
      calls.push('class');
      return true;
    }
  }
  @Injectable()
  class MethodGate implements CanActivate {
    canActivate() {
      calls.push('method');
      return true;
    }
  }
  @Controller()
  @UseGuards(ClassGate)
  class First {
    @Command('first', { aliases: ['f'] })
    @UseGuards(MethodGate)
    @Cooldown({ scope: 'command', durationMs: 60000, message: 'cooldown' })
    first(
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
      calls.push('handler');
      return word;
    }
  }
  @Controller()
  class Second {
    @Command('second') second() {
      calls.push('second-handler');
      return 'second';
    }
  }
  @Module({
    guards: [ModuleGate],
    providers: [ModuleGate, ClassGate, MethodGate],
    controllers: [First, Second],
  })
  class Root {}
  const h = await start(t, Root);
  await h.dispatch(message('/f "broken'));
  await h.dispatch(message('/second'));
  assert.deepEqual(calls, ['module:first', 'module:second']);
  allowed = true;
  await h.dispatch(message('/f ok'));
  assert.deepEqual(calls.slice(2), ['module:first', 'class', 'method', 'parse', 'handler']);
  await h.dispatch(message('/first ok'));
  await h.dispatch(message('/second'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['module denied', 'module denied', 'ok', 'cooldown', 'second'],
  );
  assert.equal(h.errors.length, 0);
});

await test('module configuration precedes module class decorators and inherited controller guards', async (t) => {
  const calls: string[] = [];
  const guard = (name: string): CanActivate => ({
    canActivate: () => {
      calls.push(name);
      return true;
    },
  });
  @UseGuards('module-base')
  class BaseModule {}
  @Controller()
  @UseGuards('controller-base')
  class BaseController {
    @Command('x') @UseGuards('method') x() {
      return 'ok';
    }
  }
  @Controller()
  @UseGuards('controller-child')
  class ChildController extends BaseController {}
  const metadata: ModuleMetadata = {
    controllers: [ChildController],
    guards: ['configured'],
    providers: [
      'configured',
      'module-base',
      'module-child',
      'controller-base',
      'controller-child',
      'method',
    ].map((name) => ({ provide: name, useValue: guard(name) })),
  };
  @Module(metadata)
  @UseGuards('module-child')
  class First extends BaseModule {}
  @UseGuards('module-child')
  @Module(metadata)
  class Second extends BaseModule {}
  for (const root of [First, Second]) {
    const h = await start(t, root);
    calls.length = 0;
    await h.dispatch(message('/x'));
    assert.deepEqual(calls, [
      'configured',
      'module-base',
      'module-child',
      'controller-base',
      'controller-child',
      'method',
    ]);
    assert.equal(h.messages[0]?.payload.content, 'ok');
  }
});

await test('module guards do not leak into imports, parents, siblings or diamond-shared modules', async (t) => {
  let sharedChecks = 0;
  const deny: CanActivate = { canActivate: () => ({ allow: false, message: 'denied' }) };
  @Controller()
  class SharedController {
    @Command('shared') x() {
      return 'shared';
    }
  }
  @Module({
    guards: ['shared-guard'],
    providers: [
      {
        provide: 'shared-guard',
        useValue: {
          canActivate: () => {
            sharedChecks++;
            return true;
          },
        },
      },
    ],
    controllers: [SharedController],
  })
  class Shared {}
  @Controller()
  class AController {
    @Command('a') x() {
      return 'a';
    }
  }
  @Module({
    imports: [Shared],
    guards: ['deny'],
    providers: [{ provide: 'deny', useValue: deny }],
    controllers: [AController],
  })
  class A {}
  @Controller()
  class BController {
    @Command('b') x() {
      return 'b';
    }
  }
  @Module({ imports: [Shared], controllers: [BController] })
  class B {}
  @Controller()
  class RootController {
    @Command('root') x() {
      return 'root';
    }
  }
  @Module({ imports: [A, B, HelpModule], controllers: [RootController] })
  class Root {}
  const h = await start(t, Root);
  for (const command of ['a', 'b', 'root', 'shared']) await h.dispatch(message(`/${command}`));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['denied', 'b', 'root', 'shared'],
  );
  assert.equal(sharedChecks, 1);
  await h.dispatch(message('/help a'));
  assert.match(h.messages[4]?.payload.content ?? '', /用法：\/a/u);
  assert.equal(h.errors.length, 0);
});

await test('identical tokens resolve in the declaring module, including injected asynchronous guard factories', async (t) => {
  const TOKEN = Symbol('module-gate');
  @Injectable()
  class Policy {
    constructor(@Inject('allowed') readonly allowed: boolean) {}
    canActivate(): boolean {
      return this.allowed;
    }
  }
  @Controller()
  class AController {
    @Command('a') x() {
      return 'a';
    }
  }
  @Controller()
  class BController {
    @Command('b') x() {
      return 'b';
    }
  }
  @Module({
    guards: [TOKEN],
    providers: [
      { provide: 'allowed', useValue: false },
      Policy,
      {
        provide: TOKEN,
        inject: [Policy],
        useFactory: async (policy: Policy) => {
          await Promise.resolve();
          return policy;
        },
      },
    ],
    controllers: [AController],
  })
  class A {}
  @Module({
    guards: [TOKEN],
    providers: [{ provide: TOKEN, useValue: { canActivate: () => true } }],
    controllers: [BController],
  })
  class B {}
  @Module({ imports: [A, B] })
  class Root {}
  const h = await start(t, Root);
  await h.dispatch(message('/a'));
  await h.dispatch(message('/b'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['b'],
  );
});

await test('exported guards retain their provider dependencies and cannot access unexported or ambiguous providers', async (t) => {
  @Injectable()
  class Gate implements CanActivate {
    constructor(@Inject('value') private readonly allowed: boolean) {}
    canActivate() {
      return this.allowed;
    }
  }
  @Module({ providers: [Gate, { provide: 'value', useValue: true }], exports: [Gate] })
  class Permissions {}
  @Controller()
  class Commands {
    @Command('x') x() {
      return 'allowed';
    }
  }
  @Module({
    imports: [Permissions],
    guards: [Gate],
    providers: [{ provide: 'value', useValue: false }],
    controllers: [Commands],
  })
  class Root {}
  const h = await start(t, Root);
  await h.dispatch(message('/x'));
  assert.equal(h.messages[0]?.payload.content, 'allowed');
  @Module({ providers: [Gate, { provide: 'value', useValue: true }] })
  class Hidden {}
  @Module({ imports: [Hidden], guards: [Gate], controllers: [Commands] })
  class Invisible {}
  await assert.rejects(createTestApplication(Invisible), /not visible/u);
  @Module({ providers: [Gate, { provide: 'value', useValue: true }], exports: [Gate] })
  class Other {}
  @Module({ imports: [Permissions, Other], guards: [Gate], controllers: [Commands] })
  class Ambiguous {}
  await assert.rejects(createTestApplication(Ambiguous), /Ambiguous/u);
});

await test('module guards protect callback handlers, preserve manual ACK fallback, and leave raw observers independent', async (t) => {
  let allowed = false,
    observed = 0,
    handled = 0;
  @Injectable()
  class Gate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      assert.equal(ctx.kind, 'button');
      return allowed || { allow: false, message: 'blocked' };
    }
  }
  @Controller()
  class Buttons {
    @On('INTERACTION_CREATE') observe(): void {
      observed++;
    }
    @OnButton('button') async click(@Ctx() ctx: ButtonContext): Promise<void> {
      handled++;
      await ctx.ack();
      await ctx.send('ok');
    }
  }
  @Module({ guards: [Gate], providers: [Gate], controllers: [Buttons] })
  class Root {}
  const h = await start(t, Root, true);
  for (const value of [false, true]) {
    allowed = value;
    await h.dispatch({
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: `click-${++next}`,
        chat_type: 2,
        user_openid: 'u',
        data: { resolved: { button_id: 'button' } },
      },
    });
  }
  assert.equal(observed, 2);
  assert.equal(handled, 1);
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['blocked', 'ok'],
  );
  assert.deepEqual(
    h.acknowledgments.map((a) => a.code),
    [0, 0],
  );
  assert.equal(h.errors.length, 0);
});

await test('built-in guards on module classes enforce scenes and detect conflicts across all three scopes', async (t) => {
  @Controller()
  class Commands {
    @Command('x') x() {
      return 'group';
    }
  }
  @Module({ controllers: [Commands] })
  @GroupOnly({ message: 'group only' })
  class GroupModule {}
  const h = await start(t, GroupModule);
  await h.dispatch(message('/x'));
  await h.dispatch(message('/x', 'u', 'g'));
  assert.deepEqual(
    h.messages.map((m) => m.payload.content),
    ['group only', 'group'],
  );
  @Controller()
  @PrivateOnly()
  class PrivateController {
    @Command('p') x() {}
  }
  @Module({ controllers: [PrivateController] })
  @GroupOnly()
  class ClassConflict {}
  @Controller()
  class OwnerController {
    @Command('owner') @GroupRoles('owner') x() {}
  }
  @Module({ controllers: [OwnerController] })
  @GroupRoles('admin')
  class RoleConflict {}
  @Controller()
  class Callback {
    @OnButton('x') x() {}
  }
  @Module({ controllers: [Callback] })
  @GroupManagersOnly()
  class InvalidButton {}
  @Module({})
  @GroupOnly()
  @PrivateOnly()
  class EmptyConflict {}
  for (const root of [ClassConflict, RoleConflict, InvalidButton, EmptyConflict])
    await assert.rejects(createTestApplication(root), configError);
});

await test('module guard configuration is copied when declared, and repeated scope declarations are not deduplicated', async (t) => {
  let calls = 0;
  const guard: CanActivate = {
    canActivate: () => {
      calls++;
      return true;
    },
  };
  const guards = ['gate'];
  @Controller()
  @UseGuards('gate')
  class Commands {
    @Command('x') @UseGuards('gate') x() {
      return 'ok';
    }
  }
  const declaration = Module({
    guards,
    providers: [{ provide: 'gate', useValue: guard }],
    controllers: [Commands],
  });
  guards.splice(0, 1, 'missing');
  @declaration
  class Root {}
  const h = await start(t, Root);
  await h.dispatch(message('/x'));
  assert.equal(calls, 3);
  assert.equal(h.messages[0]?.payload.content, 'ok');
});

await test('bad module guard tokens fail before construction, even for an empty module', async () => {
  let constructed = 0;
  @Injectable()
  class Resource {
    constructor() {
      constructed++;
    }
  }
  @Module({ guards: ['missing'], providers: [Resource] })
  class Missing {}
  await assert.rejects(createTestApplication(Missing), /not visible/u);
  assert.equal(constructed, 0);
  @Controller()
  class Commands {
    @Command('x') x() {}
  }
  @Module({ guards: [Commands as unknown as Type<CanActivate>], controllers: [Commands] })
  class ControllerAsGuard {}
  await assert.rejects(createTestApplication(ControllerAsGuard), /providers, not controllers/u);
  const invalid: unknown[] = [
    null,
    'gate',
    {},
    [null],
    [''],
    [123],
    [{ canActivate: () => true }],
    [GroupOnly()],
    Array<string>(1),
  ];
  for (const guards of invalid)
    assert.throws(() => Module({ guards } as ModuleMetadata), configError);
  assert.throws(() => Module(null as unknown as ModuleMetadata), configError);
});

await test('invalid module guard factories roll back owned resources even when no controller uses them', async () => {
  let destroyed = 0;
  @Module({
    guards: ['broken'],
    providers: [
      {
        provide: 'broken',
        useFactory: () => ({
          onModuleDestroy() {
            destroyed++;
          },
        }),
      },
    ],
  })
  class Broken {}
  await assert.rejects(createTestApplication(Broken), /canActivate/u);
  assert.equal(destroyed, 1);
});

await test('module metadata itself is not inherited, while guard decorators follow normal class inheritance', async (t) => {
  @Injectable()
  class Deny implements CanActivate {
    canActivate() {
      return false;
    }
  }
  @Controller()
  class BaseController {
    @Command('base') x() {
      return 'base';
    }
  }
  @Module({ guards: [Deny], providers: [Deny], controllers: [BaseController] })
  class Base {}
  @Controller()
  class ChildController {
    @Command('child') x() {
      return 'child';
    }
  }
  @Module({ controllers: [ChildController] })
  class Child extends Base {}
  const h = await start(t, Child);
  assert.equal(await h.dispatch(message('/base')), 'ignored');
  await h.dispatch(message('/child'));
  assert.equal(h.messages[0]?.payload.content, 'child');
});
