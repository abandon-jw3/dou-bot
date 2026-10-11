import assert from 'node:assert/strict';
import { Command, Controller, Module } from 'dou-bot';
import type { ApplicationSnapshot } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

@Controller()
class Commands {
  @Command('ping') ping(): string {
    return 'pong';
  }
}
@Module({ controllers: [Commands] })
class Root {}
const h = await createTestApplication(Root, {
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
    const result = await h.dispatch({
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
  const snapshot: ApplicationSnapshot = h.app.snapshot();
  assert.equal(snapshot.capacity.replyScopes.size, 2);
  assert.equal(snapshot.capacity.replyScopes.limit, 2);
  assert.equal(snapshot.rejections.replyScopesFull, 1);
  assert.equal(snapshot.timing.queueWait.count, 2);
  assert.equal(snapshot.timing.processing.count, 2);
  assert.equal(h.messages.length, 2);
} finally {
  await h.app.close();
}
assert.equal(h.app.snapshot().capacity.replyScopes.size, 0);
console.log('Capacity diagnostics verified in the current tarball.');
