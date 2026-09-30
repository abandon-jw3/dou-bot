import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Command, Controller, Module } from '../src/index.js';
import type { QQDispatch } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestAdmission } from '../src/testing/index.js';

await test('public testing admission tracks completion independently from handler success', async (t) => {
  @Controller()
  class Commands {
    @Command('fail') fail(): void {
      throw new Error('Deliberate public testing fixture error');
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const harness = await createTestApplication(Root);
  t.after(() => harness.app.close());
  const event: QQDispatch = {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'admission', author: { id: 'user' }, content: '/fail' },
  };
  const initial: TestAdmission = harness.enqueue(event);
  assert.deepEqual(initial, { status: 'stopping' });
  await harness.app.start();
  const admitted: TestAdmission = harness.enqueue(event);
  const repeated: TestAdmission = harness.enqueue(event);
  assert.ok('done' in admitted && 'done' in repeated);
  assert.equal(admitted.status, 'accepted');
  assert.equal(repeated.status, 'duplicate');
  assert.equal(admitted.done, repeated.done);
  await admitted.done;
  await harness.flush();
  assert.equal(harness.errors.length, 1);
  assert.equal(harness.errors[0]?.context.phase, 'command');
  assert.equal(harness.messages.length, 0);
  await harness.app.close();
  assert.deepEqual(harness.enqueue(event), { status: 'stopping' });
});
