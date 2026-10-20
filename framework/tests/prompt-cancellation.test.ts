import assert from 'node:assert/strict';
import test from 'node:test';
import { FrameworkError } from '../src/core/errors.js';
import { PromptManager, resolvePrompts } from '../src/core/prompts.js';
import { FakeClock } from './fake-clock.js';

await test('prompt cleanup constructs a cancellation reason only for the matching pending owner', async () => {
  const clock = new FakeClock();
  const manager = new PromptManager<object, never>(resolvePrompts(), clock, {
    suspend() {},
    resume(_owner, continuation) {
      continuation();
    },
    abort() {
      assert.fail('Ordinary cancellation must not abort the handler');
    },
    fallback() {
      assert.fail('No input was supplied');
    },
  });
  const owner = {};
  const controller = new AbortController();
  const reasons: FrameworkError[] = [];
  const reason = () => {
    const error = new FrameworkError('INVALID_STATE', 'Handler ended with an unawaited prompt');
    reasons.push(error);
    return error;
  };
  manager.cancelOwner(owner, reason);
  manager.cancelSignal(owner, controller.signal, reason);
  assert.equal(reasons.length, 0);
  for (const method of ['signal', 'owner'] as const) {
    const pending = manager.request(
      owner,
      'conversation',
      controller.signal,
      () => Promise.resolve(),
      () => assert.fail('No message should be consumed'),
    );
    const rejected = assert.rejects(pending, (error: unknown) => error === reasons.at(-1));
    await clock.flush();
    const before: number = reasons.length;
    manager.cancelOwner({}, reason);
    manager.cancelSignal(owner, new AbortController().signal, reason);
    assert.equal(reasons.length, before);
    if (method === 'signal') manager.cancelSignal(owner, controller.signal, reason);
    else manager.cancelOwner(owner, reason);
    await rejected;
    assert.equal(reasons.length, before + 1);
    assert.equal(manager.size, 0);
    assert.equal(clock.pending, 0);
    manager.cancelOwner(owner, reason);
    assert.equal(reasons.length, before + 1);
  }
  assert.notEqual(reasons[0], reasons[1]);
});
