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
  Injectable,
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
