import assert from 'node:assert/strict';
import { Command, Controller, Module } from 'dou-bot';
import type { DiagnosticsOptions, DiagnosticsReader, DiagnosticsSpan } from 'dou-bot';
import { createMultiTestApplication } from 'dou-bot/testing';

@Controller()
class Commands {
  @Command('ping') ping(): string {
    return 'pong';
  }
}
@Module({ controllers: [Commands] })
class Root {}
const collected: DiagnosticsSpan[] = [];
const diagnostics: DiagnosticsOptions = {
  enabled: true,
  traceSampleRate: 1,
  onSpans(batch, signal) {
    signal.throwIfAborted();
    collected.push(...batch);
  },
};
const h = await createMultiTestApplication(Root, { diagnostics });
const reader: DiagnosticsReader = h.app.diagnostics;
await h.app.start();
try {
  await h.dispatch('offline-app', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'private-message', content: '/ping', author: { user_openid: 'private-user' } },
  });
  assert.equal(h.messages.length, 1);
  assert.equal(h.errors.length, 0);
  assert.ok(
    reader.snapshot().metrics.some((m) => m.stage === 'qq.http' && m.operation === 'message'),
  );
  assert.equal(reader.snapshot().activeSpans, 0);
} finally {
  await h.app.close();
}
assert.ok(collected.some((s) => s.stage === 'handler.invoke'));
assert.equal(reader.snapshot().closed, true);
assert.equal(JSON.stringify(collected).includes('private-user'), false);
console.log('Bounded stage diagnostics verified in the current tarball.');
