import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createTestApplication } from '../src/testing/index.js';
import { createAttachmentsProbe } from '../examples/attachments-probe.js';
import type { AttachmentProbeRecord } from '../examples/attachments-probe.js';
import type { QQDispatch } from '../src/index.js';

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

await test('attachment probe exercises all selectors and captures only sanitized metadata and send results', async (t) => {
  const records: AttachmentProbeRecord[] = [];
  const probe = createAttachmentsProbe('c0ffee', (entry) => records.push(entry));
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
      await harness.dispatch(
        input(
          probe.commands[kind],
          [
            {
              url: 'https://sensitive.invalid/file?token=private-download-token',
              content_type: types[kind],
              filename: 'private-filename',
              voice_wav_url: 'https://sensitive.invalid/private-wav',
              asr_refer_text: 'private-transcription',
            },
          ],
          scene,
        ),
      );
    }
  }
  const selected = records.filter((entry) => entry.event === 'selected');
  assert.equal(selected.length, 10);
  assert.ok(selected.every((entry) => entry.count === 1 && entry.frozen === true));
  assert.equal(
    records.filter((entry) => entry.event === 'reply' && entry.status === 'sent').length,
    11,
  );
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
});
