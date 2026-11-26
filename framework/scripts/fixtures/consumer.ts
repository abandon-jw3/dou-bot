import assert from 'node:assert/strict';
import {
  AppFactory,
  Args,
  BotManager,
  Command,
  ContextValue,
  Controller,
  Ctx,
  Database,
  Group,
  GroupRoutes,
  Images,
  Injectable,
  MessageSender,
  Module,
  OnAttachment,
  Role,
  Slot,
  UseMiddleware,
  User,
  button,
  createContextKey,
  keyboard,
  markdown,
  migrateDatabase,
  selectAttachments,
} from 'dou-bot';
import type {
  ApplicationSnapshot,
  Attachment,
  BotSnapshot,
  BotTarget,
  ContextMiddleware,
  DiagnosticsOptions,
  DiagnosticsReader,
  DiagnosticsSpan,
  GroupInfo,
  GroupRole,
  MessageContext,
  UserInfo,
  WebhookTransportOptions,
} from 'dou-bot';
import { createMultiTestApplication } from 'dou-bot/testing';
import type { TestAdmission, TestHarness } from 'dou-bot/testing';

const traceKey = createContextKey<string>('trace');

@Injectable()
class TraceMiddleware implements ContextMiddleware {
  prepare(ctx: Parameters<ContextMiddleware['prepare']>[0]): void {
    ctx.state.set(traceKey, `${ctx.appId}:${ctx.scene}`);
  }
}

@Injectable()
class Shared {
  constructor(
    readonly sender: MessageSender,
    readonly bots: BotManager,
    readonly db: Database,
  ) {}
}

@Controller()
@UseMiddleware(TraceMiddleware)
class Commands {
  constructor(readonly shared: Shared) {}

  @Command('ping')
  ping(
    @Ctx() ctx: MessageContext,
    @User() user: UserInfo,
    @Group() group: GroupInfo | undefined,
    @Role() role: GroupRole | undefined,
    @ContextValue(traceKey) trace: string,
  ): string {
    return JSON.stringify({ appId: ctx.appId, user: user.id, group: group?.id, role, trace });
  }

  @Command('诛恶')
  wicked(
    @Slot('server', { choices: ['梦江南', '双梦'], normalize: () => '梦江南' })
    server: string | undefined,
    @Args() args: string[],
  ): string {
    return JSON.stringify({ server, args });
  }

  @Command('photo')
  photo(@Images({ minCount: 1, maxCount: 2 }) images: readonly Attachment[]): string {
    return String(images.length);
  }

  @OnAttachment({ extension: '.txt' })
  onDoc(@Ctx() ctx: MessageContext): string {
    return ctx.attachments[0]?.filename ?? 'none';
  }
}

@Module({ providers: [Shared, TraceMiddleware], controllers: [Commands] })
class Root {}

function completion(harness: TestHarness, result: TestAdmission): Promise<void> {
  if ('done' in result) return result.done;
  return harness.flush();
}
void completion;

// Validate public AppOptions & WebhookTransportOptions without opening real connections.
const webhook = { type: 'webhook', verifyTimeoutMs: 250 } satisfies WebhookTransportOptions;
const unstarted = await AppFactory.create(Root, {
  database: { host: '127.0.0.1', user: 'offline', password: '', database: 'offline' },
  bots: [{ appId: 'webhook-config', secret: 'offline-secret', transport: webhook }],
  webhook: { listen: false },
});
await unstarted.close();
assert.equal(typeof migrateDatabase, 'function');

const collected: DiagnosticsSpan[] = [];
const diagnostics: DiagnosticsOptions = {
  enabled: true,
  traceSampleRate: 1,
  onSpans(batch, signal) {
    signal.throwIfAborted();
    collected.push(...batch);
  },
};

const h = await createMultiTestApplication(Root, {
  bots: [{ appId: 'a' }, { appId: 'b' }],
  diagnostics,
});
const reader: DiagnosticsReader = h.app.diagnostics;
await h.app.start();
try {
  for (const id of ['a', 'b']) {
    await h.dispatch(id, {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: `ping-${id}`,
        group_openid: `group-${id}`,
        content: '/ping',
        author: { member_openid: 'same', member_role: 'admin' },
      },
    });
  }
  assert.deepEqual(JSON.parse(h.messages[0]!.payload.content!), {
    appId: 'a',
    user: 'same',
    group: 'group-a',
    role: 'admin',
    trace: 'a:group',
  });

  const target: BotTarget = { appId: 'b', scene: 'group', groupId: 'group-b' };
  await h.app.get(MessageSender).sendMessage(target, 'background');
  assert.equal((await h.app.get(GroupRoutes).resolve('group-a')).appId, 'a');

  const buttons = Array.from({ length: 5 }, (_, i) => button.callback(String(i), String(i)));
  await h.app.bots
    .get('b')
    .client.sendMessage(target, markdown('菜单', { keyboard: keyboard(buttons, 3) }));
  assert.deepEqual(
    h.messages.at(-1)!.payload.keyboard!.content.rows.map((row) => row.buttons.length),
    [3, 2],
  );

  await h.dispatch('a', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'slot-1', author: { user_openid: 'user-a' }, content: '/诛恶 其他 双梦' },
  });
  assert.deepEqual(JSON.parse(h.messages.at(-1)!.payload.content!), {
    server: '梦江南',
    args: ['其他', '双梦'],
  });

  await h.dispatch('a', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'att-1',
      author: { user_openid: 'user-a' },
      content: '',
      attachments: [{ url: 'https://example.invalid/note.txt', filename: 'note.txt' }],
    },
  });
  assert.equal(h.messages.at(-1)!.payload.content, 'note.txt');
  assert.equal(selectAttachments([], { kind: 'image', minCount: 1 }).status, 'invalid');

  const appSnap: ApplicationSnapshot = h.app.snapshot();
  const botSnap: BotSnapshot = h.app.bots.get('a').snapshot();
  assert.equal(appSnap.bots.length, 2);
  assert.ok(botSnap.timing.processing.count >= 1);
  assert.ok(reader.snapshot().metrics.some((m) => m.stage === 'qq.http'));
  assert.deepEqual(h.errors, []);
} finally {
  await h.app.close();
}
assert.ok(collected.some((s) => s.stage === 'handler.invoke'));
assert.equal(reader.snapshot().closed, true);
console.log('Package consumer smoke verified.');
