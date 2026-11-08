import assert from 'node:assert/strict';
import {
  AppFactory,
  BotManager,
  Database,
  GroupRoutes,
  MessageSender,
  Module,
  Controller,
  Command,
  Ctx,
  Args,
  Slot,
  Injectable,
  button,
  keyboard,
  markdown,
  migrateDatabase,
} from 'dou-bot';
import type { MessageContext, BotTarget, ApplicationSnapshot, AppOptions } from 'dou-bot';
import { createMultiTestApplication } from 'dou-bot/testing';
@Injectable()
class Shared {
  constructor(
    readonly sender: MessageSender,
    readonly bots: BotManager,
    readonly db: Database,
  ) {}
}
@Controller()
class Commands {
  constructor(readonly shared: Shared) {}
  @Command('ping') ping(@Ctx() ctx: MessageContext) {
    return ctx.appId;
  }
  @Command('诛恶') wicked(
    @Slot('server', {
      choices: ['梦江南', '双梦'],
      normalize: () => '梦江南',
    })
    server: string | undefined,
    @Args() args: string[],
  ): string {
    return JSON.stringify({ server, args });
  }
}
@Module({ providers: [Shared], controllers: [Commands] })
class Root {}
const h = await createMultiTestApplication(Root, { bots: [{ appId: 'a' }, { appId: 'b' }] });
await h.app.start();
try {
  for (const id of ['a', 'b'])
    await h.dispatch(id, {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'same',
        group_openid: `group-${id}`,
        content: '/ping',
        author: { member_openid: 'same' },
      },
    });
  const target: BotTarget = { appId: 'b', scene: 'group', groupId: 'group-b' };
  await h.app.get(MessageSender).sendMessage(target, 'background');
  assert.equal((await h.app.get(GroupRoutes).resolve('group-a')).appId, 'a');
  assert.deepEqual(
    h.messages.map((message) => message.appId),
    ['a', 'b', 'b'],
  );
  const buttons = Array.from({ length: 9 }, (_, i) => button.callback(String(i), String(i)));
  const client = h.app.bots.get('b').client;
  for (const perRow of [4, [2, 3]] as const) {
    await client.sendMessage(target, markdown('菜单', { keyboard: keyboard(buttons, perRow) }));
    const rows = h.messages.at(-1)!.payload.keyboard!.content.rows;
    assert.deepEqual(
      rows.map((row) => row.buttons.length),
      perRow === 4 ? [4, 4, 1] : [2, 3, 3, 1],
    );
    assert.deepEqual(
      rows.flatMap((row) => row.buttons.map((item) => item.id)),
      buttons.map((_, i) => String(i)),
    );
  }
  for (const group of [false, true]) {
    await h.dispatch('a', {
      op: 0,
      t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
      d: {
        id: `extra-words-${group}`,
        ...(group
          ? { group_openid: 'group-a', author: { member_openid: 'user-a' } }
          : { author: { user_openid: 'user-a' } }),
        content: '/诛恶 其他 双梦 121',
      },
    });
    assert.deepEqual(JSON.parse(h.messages.at(-1)!.payload.content!), {
      server: '梦江南',
      args: ['其他', '双梦', '121'],
    });
  }
  assert.deepEqual(h.errors, []);
  const snapshot: ApplicationSnapshot = h.app.snapshot();
  assert.equal(snapshot.bots.length, 2);
  assert.equal(typeof AppFactory.create, 'function');
  assert.equal(typeof migrateDatabase, 'function');
  const options: AppOptions = {
    database: { host: 'localhost', user: 'test', password: '', database: 'test' },
    bots: [{ appId: 'a', secret: 'test' }],
  };
  void options;
} finally {
  await h.app.close();
}
