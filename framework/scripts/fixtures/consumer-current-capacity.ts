import assert from 'node:assert/strict';
import { Command, Controller, Module } from 'dou-bot';
import type { ApplicationSnapshot, BotSnapshot } from 'dou-bot';
import { createMultiTestApplication } from 'dou-bot/testing';

@Controller()
class Commands {
  @Command('ping') ping(): string {
    return 'pong';
  }
}
@Module({ controllers: [Commands] })
class Root {}
const h = await createMultiTestApplication(Root, {
  bots: [{ appId: 'capacity' }],
  execution: {
    concurrency: 1,
    queueCapacity: 1,
    dedupMaxEntries: 2,
    replyScopeMaxEntries: 2,
  },
});
await h.app.start();
try {
  for (let index = 0; index < 3; index++) {
    const result = await h.dispatch('capacity', {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: `capacity-${index}`,
        group_openid: 'group',
        author: { member_openid: 'user' },
        content: '/ping',
      },
    });
    assert.equal(result, index < 2 ? 'accepted' : 'overloaded');
  }
  const application: ApplicationSnapshot = h.app.snapshot();
  const bot: BotSnapshot = h.app.bots.get('capacity').snapshot();
  assert.equal(application.bots.length, 1);
  assert.equal(application.inbound.active, 0);
  assert.equal(application.outbound.completed, 2);
  assert.equal(bot.capacity.replyScopes.size, 2);
  assert.equal(bot.capacity.replyScopes.limit, 2);
  assert.equal(bot.rejections.replyScopesFull, 1);
  assert.equal(bot.timing.queueWait.count, 2);
  assert.equal(bot.timing.processing.count, 2);
  assert.equal(h.messages.length, 2);
} finally {
  await h.app.close();
}
assert.equal(h.app.bots.get('capacity').snapshot().capacity.replyScopes.size, 0);
console.log('Application and account capacity diagnostics verified in the source tarball.');
