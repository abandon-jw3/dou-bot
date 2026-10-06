import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createTestApplication } from '../src/testing/index.js';
import { createAttachmentsProbe } from '../examples/attachments-probe.js';
import type { AttachmentProbeRecord } from '../examples/attachments-probe.js';
import type { QQDispatch } from '../src/index.js';
import { until } from './helpers.js';

let next = 0;
function input(
  content: string,
  attachments: unknown[],
  scene: 'private' | 'group',
  user = 'private-user-id',
  group = 'private-group-id',
): QQDispatch {
  return {
    op: 0,
    t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
    d: {
      id: `probe-${++next}`,
      content,
      attachments,
      ...(scene === 'private'
        ? { author: { user_openid: user } }
        : { group_openid: group, author: { member_openid: user } }),
    },
  };
}

await test('attachment probe uses same-message images and separate media inputs with sanitized records', async (t) => {
  const records: AttachmentProbeRecord[] = [];
  const probe = createAttachmentsProbe('c0ffee', (entry) => records.push(entry));
  assert.equal(probe.inputModes.images, 'same-message');
  assert.equal(probe.inputModes.videos, 'next-message');
  const harness = await createTestApplication(probe.root, {
    commands: { invalidInput: 'reply' },
    onError: (error, context) => probe.onError(error, context),
  });
  const restore = probe.instrument(harness.app);
  t.after(async () => {
    await harness.app.close();
    restore();
  });
  await harness.app.start();
  await harness.dispatch(input(probe.commands.images, [], 'private'));
  await tick();
  assert.ok(records.some((entry) => entry.event === 'error' && entry.code === 'PARAMETER_PARSE'));
  const types = {
    images: 'image/png',
    videos: 'video/mp4',
    audios: 'voice',
    files: 'application/pdf',
    attachments: 'https://sensitive.invalid/not-a-content-type',
  };
  for (const scene of ['private', 'group'] as const) {
    for (const kind of Object.keys(types) as (keyof typeof types)[]) {
      const attachments = [
        {
          url: 'https://sensitive.invalid/file?token=private-download-token',
          content_type: types[kind],
          filename: 'private-filename',
          voice_wav_url: 'https://sensitive.invalid/private-wav',
          asr_refer_text: 'private-transcription',
        },
      ];
      if (kind === 'images' || kind === 'attachments') {
        await harness.dispatch(input(probe.commands[kind], attachments, scene));
      } else {
        const before = harness.messages.length;
        const start = harness.enqueue(input(probe.commands[kind], [], scene));
        assert.ok('done' in start);
        await until(() => harness.messages.length === before + 1);
        const payload = input('', attachments, scene);
        const answer = harness.enqueue(payload);
        assert.ok('done' in answer);
        const duplicate = harness.enqueue(payload);
        assert.ok(duplicate.status === 'duplicate');
        assert.equal(duplicate.done, answer.done);
        await Promise.all([start.done, answer.done, duplicate.done]);
        assert.equal(harness.messages.at(-1)?.payload.msg_id, (payload.d as { id: string }).id);
      }
    }
  }
  const selected = records.filter((entry) => entry.event === 'selected');
  assert.equal(selected.length, 10);
  assert.ok(selected.every((entry) => entry.count === 1 && entry.frozen === true));
  assert.equal(
    records.filter((entry) => entry.event === 'reply' && entry.status === 'sent').length,
    17,
  );
  assert.equal(records.filter((entry) => entry.event === 'waiting').length, 6);
  assert.equal(records.filter((entry) => entry.event === 'input-received').length, 6);
  assert.ok(
    selected.some(
      (entry) =>
        entry.kind === 'audios' &&
        entry.contentTypes === 'voice' &&
        entry.hasVoiceWavUrl === true &&
        entry.hasAsrReferText === true,
    ),
  );
  const serialized = JSON.stringify(records);
  for (const secret of [
    'private-user-id',
    'private-group-id',
    'sensitive.invalid',
    'private-download-token',
    'private-filename',
    'private-wav',
    'private-transcription',
  ])
    assert.equal(serialized.includes(secret), false);
});

await test('attachment probe binds one user and target per scene and silently excludes other participants', async (t) => {
  assert.throws(
    () => createAttachmentsProbe('invalid', () => {}),
    /Invalid attachment probe token/u,
  );
  const records: AttachmentProbeRecord[] = [];
  const probe = createAttachmentsProbe('abcdef', (entry) => records.push(entry));
  const harness = await createTestApplication(probe.root);
  t.after(() => harness.app.close());
  await harness.app.start();
  const attachments = [{ url: 'https://example.invalid/picture.png', content_type: 'image/png' }];
  await harness.dispatch(input(probe.commands.images, attachments, 'private'));
  await harness.dispatch(input(probe.commands.images, attachments, 'group'));
  const recorded = records.length;
  await harness.dispatch(input(probe.commands.images, attachments, 'private', 'another-user'));
  await harness.dispatch(input(probe.commands.images, attachments, 'group', 'another-user'));
  await harness.dispatch(
    input(probe.commands.images, attachments, 'group', 'private-user-id', 'another-group'),
  );
  assert.equal(records.length, recorded);
  assert.equal(harness.messages.length, 2);
  assert.deepEqual(harness.errors, []);

  const before = harness.messages.length;
  const start = harness.enqueue(input(probe.commands.files, [], 'group'));
  assert.ok('done' in start);
  await until(() => harness.messages.length === before + 1);
  const awaitingRecords = records.length;
  for (const payload of [
    input('', attachments, 'group', 'another-user'),
    input('', attachments, 'group', 'private-user-id', 'another-group'),
    input('', attachments, 'private'),
  ])
    assert.equal(await harness.dispatch(payload), 'ignored');
  assert.equal(records.length, awaitingRecords);
  assert.equal(harness.app.snapshot().prompts.pending, 1);
  const answer = harness.enqueue(
    input('', [{ url: 'https://example.invalid/file', content_type: 'file' }], 'group'),
  );
  assert.ok('done' in answer);
  await Promise.all([start.done, answer.done]);
  assert.equal(harness.app.snapshot().prompts.pending, 0);
  assert.deepEqual(harness.errors, []);
});

await test('media probe reports invalid input without automatically retrying, re-routing or reporting a framework error', async (t) => {
  const records: AttachmentProbeRecord[] = [];
  const probe = createAttachmentsProbe('abcdef', (entry) => records.push(entry));
  const harness = await createTestApplication(probe.root, { commands: { invalidInput: 'reply' } });
  t.after(() => harness.app.close());
  await harness.app.start();
  for (const [scene, attachments, reason, count] of [
    [
      'private',
      [{ url: 'https://example.invalid/image', content_type: 'image/png' }],
      'too-few',
      0,
    ],
    [
      'group',
      [
        { url: 'https://example.invalid/a', content_type: 'file' },
        { url: 'https://example.invalid/b', content_type: 'file' },
      ],
      'too-many',
      2,
    ],
  ] as const) {
    const before = harness.messages.length;
    const start = harness.enqueue(input(probe.commands.files, [], scene));
    assert.ok('done' in start);
    await until(() => harness.messages.length === before + 1);
    const answer = harness.enqueue(input('', [...attachments], scene));
    assert.ok('done' in answer);
    await Promise.all([start.done, answer.done]);
    assert.ok(
      records.some(
        (entry) =>
          entry.event === 'invalid' &&
          entry.scene === scene &&
          entry.reason === reason &&
          entry.count === count &&
          entry.limit === 1,
      ),
    );
    assert.equal(harness.messages.length, before + 2);
    assert.equal(harness.app.snapshot().prompts.pending, 0);
    assert.equal(
      await harness.dispatch(
        input('', [{ url: 'https://example.invalid/later', content_type: 'file' }], scene),
      ),
      'ignored',
    );
  }
  assert.equal(
    records.some((entry) => entry.event === 'selected'),
    false,
  );
  assert.deepEqual(harness.errors, []);
});

await test('media probe records cancellation and timeout and clears the pending workflow', async (t) => {
  for (const scene of ['private', 'group'] as const) {
    for (const outcome of ['cancelled', 'timeout'] as const) {
      const records: AttachmentProbeRecord[] = [];
      const probe = createAttachmentsProbe('abcdef', (entry) => records.push(entry));
      const harness = await createTestApplication(probe.root, {
        prompts: { timeoutMs: outcome === 'cancelled' ? 5000 : 20 },
      });
      t.after(() => harness.app.close());
      await harness.app.start();
      const start = harness.enqueue(input(probe.commands.videos, [], scene));
      assert.ok('done' in start);
      await until(() => harness.messages.length === 1);
      if (outcome === 'cancelled') {
        const cancel = harness.enqueue(input('取消', [], scene));
        assert.ok('done' in cancel);
        await Promise.all([start.done, cancel.done]);
      } else {
        await until(() => records.some((entry) => entry.event === 'timeout'));
        await start.done;
      }
      assert.ok(records.some((entry) => entry.event === outcome));
      assert.equal(
        harness.messages[1]?.payload.content,
        outcome === 'cancelled' ? '附件验证：已取消。' : '附件验证：等待超时。',
      );
      assert.equal(
        records.some((entry) => entry.event === 'selected'),
        false,
      );
      assert.deepEqual(harness.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
      assert.equal(harness.app.snapshot().prompts.pending, 0);
      assert.deepEqual(harness.errors, []);
    }
  }
});

await test('closing a waiting media probe releases resources and never processes a late attachment', async () => {
  const records: AttachmentProbeRecord[] = [];
  const probe = createAttachmentsProbe('abcdef', (entry) => records.push(entry));
  const harness = await createTestApplication(probe.root, {
    onError: (error, context) => probe.onError(error, context),
  });
  try {
    await harness.app.start();
    const start = harness.enqueue(input(probe.commands.files, [], 'group'));
    assert.ok('done' in start);
    await until(() => harness.messages.length === 1);
    await harness.app.close();
    await start.done;
    assert.equal(harness.app.snapshot().prompts.pending, 0);
    assert.deepEqual(harness.app.snapshot().queue, { pending: 0, active: 0, retainedBytes: 0 });
    assert.equal(
      await harness.dispatch(
        input('', [{ url: 'https://example.invalid/file', content_type: 'file' }], 'group'),
      ),
      'stopping',
    );
    assert.equal(
      records.some((entry) => entry.event === 'selected'),
      false,
    );
    assert.ok(records.some((entry) => entry.event === 'error'));
    assert.equal(harness.messages.length, 1);
  } finally {
    await harness.app.close();
  }
});
