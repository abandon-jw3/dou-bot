import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlsProbe } from '../examples/controls-probe.js';
import type { ProbeRecord } from '../examples/controls-probe.js';
import { createTestApplication } from '../src/testing/index.js';
import type { QQDispatch } from '../src/index.js';

await test('live controls probe limits enrollment, observes validated outcomes, and does not log identities or raw text', async (t) => {
  const entries: ProbeRecord[] = [];
  const token = 'abcd1234';
  const probe = createControlsProbe(token, (entry) => entries.push(entry));
  const h = await createTestApplication(probe.root, {
    commands: { prefix: '', invalidInput: 'reply' },
    interactions: { acknowledge: 'manual' },
    onError: (error, context) => probe.onError(error, context),
  });
  const restore = probe.instrument(h.app);
  t.after(async () => {
    await h.app.close();
    restore();
  });
  await h.app.start();
  let next = 0;
  for (const scene of ['private', 'group'] as const) {
    const user = `${scene}-openid-fixture`;
    const group = 'group-openid-fixture';
    const input = (content: string, actor = user): QQDispatch => ({
      op: 0,
      t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
      d: {
        id: `probe-${++next}`,
        content,
        ...(scene === 'private'
          ? { author: { user_openid: actor } }
          : { group_openid: group, author: { member_openid: actor } }),
      },
    });
    const before = h.messages.length;
    await h.dispatch(input(`${probe.command} 北京 天气`));
    assert.equal(h.messages.length, before);
    for (const command of probe.commands) await h.dispatch(input(command));
    assert.equal(h.messages.length, before + 4);
    await h.dispatch(input(probe.commands[0]!, 'outsider-openid-fixture'));
    assert.equal(h.messages.length, before + 4);
    for (const action of ['allow', 'deny']) {
      await h.dispatch({
        op: 0,
        t: 'INTERACTION_CREATE',
        d: {
          id: `interaction-${++next}`,
          chat_type: scene === 'private' ? 2 : 1,
          ...(scene === 'private'
            ? { user_openid: user }
            : { group_openid: group, group_member_openid: user }),
          data: { resolved: { button_id: `dd-${action}-${token}`, button_data: token } },
        },
      });
    }
    assert.equal(h.messages.length, before + 6);
  }
  assert.equal(probe.complete(), true);
  assert.equal(h.acknowledgments.length, 4);
  assert.equal(h.errors.length, 2); // deliberate missing-topic cases
  assert.equal(entries.filter((entry) => entry.event === 'query-executed').length, 2);
  assert.doesNotMatch(JSON.stringify(entries), /openid-fixture|今天 天气/u);
});
