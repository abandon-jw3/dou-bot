import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameworkError, Module, button, keyboard, markdown } from '../src/index.js';
import type { MessageInput, QQMessagePayload, QQUploadImagePayload } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import type { TestRequest } from '../src/testing/index.js';

@Module({})
class Root {}
const rawButton = () => ({
  id: 'x',
  render_data: { label: 'X', style: 1 },
  action: { type: 1, data: '', permission: { type: 2 } },
});
const withKeyboard = (keyboard: unknown) => ({
  msg_type: 2,
  markdown: { content: 'hello' },
  keyboard,
});

await test('legacy template payloads are refused by both message helpers and named raw APIs', async () => {
  let requests = 0;
  const bot = await createTestApplication(Root, {
    respond: () => {
      requests++;
      return undefined;
    },
  });
  try {
    const messages: unknown[] = [
      { kind: 'markdown', body: { templateId: 'legacy', params: { title: ['hello'] } } },
      {
        kind: 'markdown',
        body: { content: 'hello' },
        keyboard: { kind: 'template', id: 'legacy' },
      },
    ];
    for (const message of messages)
      await assert.rejects(
        bot.app.client.sendMessage({ scene: 'group', groupId: 'group' }, message as MessageInput),
        (error: unknown) => error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT',
      );
    for (const payload of [
      {
        msg_type: 2,
        markdown: { custom_template_id: 'legacy', params: [{ key: 'title', values: ['hello'] }] },
      },
      { msg_type: 2, markdown: { content: 'hello' }, keyboard: { id: 'legacy' } },
    ])
      await assert.rejects(
        bot.app.client.api.sendGroupMessage('group', payload as unknown as QQMessagePayload),
        (error: unknown) => error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT',
      );
    assert.equal(requests, 0);
  } finally {
    await bot.app.close();
  }
});

await test('malformed raw media, Markdown, and keyboard structures are rejected before any network request', async () => {
  let requests = 0;
  const bot = await createTestApplication(Root, {
    respond: () => {
      requests++;
      return undefined;
    },
  });
  const invalid: unknown[] = [
    { msg_type: 7, content: 123, media: { file_info: 'fixture' } },
    { msg_type: 2, markdown: { content: '' } },
    { msg_type: 2, markdown: { content: 'a', custom_template_id: 'b' } },
    { msg_type: 2, markdown: { custom_template_id: 'a', params: [null] } },
    { msg_type: 2, markdown: { custom_template_id: 'a', params: [{ key: 'x', values: [1] }] } },
    {
      msg_type: 2,
      markdown: {
        custom_template_id: 'a',
        params: [
          { key: 'x', values: [] },
          { key: 'x', values: [] },
        ],
      },
    },
    withKeyboard({ id: 'template', content: { rows: [] } }),
    withKeyboard({ content: { rows: [] } }),
    withKeyboard({ content: { rows: [{ buttons: [] }] } }),
    withKeyboard({ content: { rows: [{ buttons: Array.from({ length: 6 }, rawButton) }] } }),
    withKeyboard({ content: { rows: [{ buttons: [rawButton()] }, { buttons: [rawButton()] }] } }),
    withKeyboard({ content: { rows: [{ buttons: [{ ...rawButton(), id: undefined }] }] } }),
    withKeyboard({
      content: {
        rows: [
          {
            buttons: [
              {
                ...rawButton(),
                action: { type: 1, data: '', permission: { type: 0, specify_user_ids: [1] } },
              },
            ],
          },
        ],
      },
    }),
    withKeyboard({
      content: {
        rows: [
          {
            buttons: [
              {
                ...rawButton(),
                action: { type: 1, data: '', enter: 'yes', permission: { type: 2 } },
              },
            ],
          },
        ],
      },
    }),
  ];
  try {
    for (const payload of invalid) {
      await assert.rejects(
        bot.app.client.api.sendGroupMessage('group', payload as QQMessagePayload),
        (error: unknown) => error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT',
      );
    }
    assert.equal(requests, 0);
  } finally {
    await bot.app.close();
  }
});

await test('raw upload validates HTTP URLs, base64, mutually exclusive sources, and the upload byte budget', async () => {
  let requests = 0;
  const bot = await createTestApplication(Root, {
    api: { maxUploadBytes: 4 },
    respond: () => {
      requests++;
      return undefined;
    },
  });
  try {
    const payloads: unknown[] = [
      ...[
        'file:///tmp/image',
        'ftp://example.invalid/file',
        'https://u:p@example.invalid/image',
        '',
      ].map((url) => ({ file_type: 1, srv_send_msg: false, url })),
      ...['', 'A===', 'abc', 'AA--'].map((file_data) => ({
        file_type: 1,
        srv_send_msg: false,
        file_data,
      })),
      { file_type: 1, srv_send_msg: false, file_data: 'AA==', url: 'https://example.invalid' },
      { file_type: 1, srv_send_msg: true, file_data: 'AA==' },
    ];
    for (const payload of payloads)
      await assert.rejects(
        bot.app.client.api.uploadGroupImage('group', payload as QQUploadImagePayload),
        (error: unknown) => error instanceof FrameworkError && error.code === 'HANDLER_CONTRACT',
      );
    await assert.rejects(
      bot.app.client.api.uploadPrivateImage('user', {
        file_type: 1,
        srv_send_msg: false,
        file_data: Buffer.alloc(5).toString('base64'),
      }),
      (error: unknown) => error instanceof FrameworkError && error.code === 'RESOURCE_LIMIT',
    );
    assert.equal(requests, 0);
  } finally {
    await bot.app.close();
  }
});

await test('every named QQ endpoint uses its expected path, encoding, response decoder, and method', async () => {
  const seen: TestRequest[] = [];
  const bot = await createTestApplication(Root, {
    respond: (request) => {
      if (request.url.pathname === '/app/getAppAccessToken') return undefined;
      seen.push(request);
      if (request.url.pathname === '/gateway')
        return Response.json({ url: 'wss://fixture.invalid/ws' });
      if (request.url.pathname === '/custom') return Response.json({ custom: true });
      if (request.url.pathname.endsWith('/messages'))
        return Response.json(
          { id: 'sent', timestamp: '2026-09-29T00:00:00Z' },
          { headers: { 'x-tps-trace-id': 'fixture-trace' } },
        );
      return undefined;
    },
  });
  try {
    assert.equal((await bot.app.client.getSelf()).id, 'offline-bot');
    assert.equal((await bot.app.client.api.getGateway()).url, 'wss://fixture.invalid/ws');
    const group = { scene: 'group' as const, groupId: 'g/# 中文' };
    const user = { scene: 'private' as const, userId: 'u/?' };
    const groupResult = await bot.app.client.sendMessage(group, 'group');
    assert.equal(groupResult.traceId, 'fixture-trace');
    assert.ok(groupResult.status === 'sent');
    assert.equal(groupResult.timestamp, Date.parse('2026-09-29T00:00:00Z'));
    await bot.app.client.sendMessage(user, 'private');
    await bot.app.client.uploadImage(group, 'https://example.invalid/a.png');
    await bot.app.client.uploadImage(user, new Uint8Array([1, 2, 3]));
    await bot.app.client.deleteMessage(group, 'msg/#');
    await bot.app.client.deleteMessage(user, 'msg/?');
    await bot.app.client.api.acknowledgeInteraction('button/#');
    assert.deepEqual(
      (
        await bot.app.client.api.request('PATCH', '/custom', {
          query: { zero: 0, empty: '', skip: undefined },
          body: { data: 'value' },
        })
      ).data,
      { custom: true },
    );
    assert.deepEqual(
      seen.map((item) => [item.method, item.url.pathname]),
      [
        ['GET', '/users/@me'],
        ['GET', '/gateway'],
        ['POST', `/v2/groups/${encodeURIComponent(group.groupId)}/messages`],
        ['POST', `/v2/users/${encodeURIComponent(user.userId)}/messages`],
        ['POST', `/v2/groups/${encodeURIComponent(group.groupId)}/files`],
        ['POST', `/v2/users/${encodeURIComponent(user.userId)}/files`],
        [
          'DELETE',
          `/v2/groups/${encodeURIComponent(group.groupId)}/messages/${encodeURIComponent('msg/#')}`,
        ],
        [
          'DELETE',
          `/v2/users/${encodeURIComponent(user.userId)}/messages/${encodeURIComponent('msg/?')}`,
        ],
        ['PUT', `/interactions/${encodeURIComponent('button/#')}`],
        ['PATCH', '/custom'],
      ],
    );
    assert.equal(seen.at(-1)?.url.search, '?zero=0&empty=');
    for (const id of ['', '.', '..', 'bad\n']) {
      assert.throws(
        () => bot.app.client.api.sendPrivateMessage(id, { msg_type: 0, content: 'x' }),
        /Invalid QQ path identifier/,
      );
    }
    assert.equal(seen.length, 10);
  } finally {
    await bot.app.close();
  }
});

await test('image lifetime accepts decimal seconds and rejects coercible non-numeric values', async () => {
  let ttl: unknown = '3600';
  const bot = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.endsWith('/files')
        ? Response.json({ file_info: 'fixture-file', ttl })
        : undefined,
  });
  try {
    const upload = () =>
      bot.app.client.api.uploadPrivateImage('user', {
        file_type: 1,
        srv_send_msg: false,
        file_data: 'AA==',
      });
    assert.equal((await upload()).ttl, 3600);
    for (const value of [true, false, [3600], {}, '', null, 0, -1, 1e30]) {
      ttl = value;
      await assert.rejects(
        upload(),
        (error: unknown) => error instanceof FrameworkError && error.code === 'PROTOCOL',
      );
    }
  } finally {
    await bot.app.close();
  }
});

await test('raw Markdown and all button kinds encode through the same validated send path', async () => {
  const bot = await createTestApplication(Root);
  try {
    const target = { scene: 'group' as const, groupId: 'group' };
    await bot.app.client.sendMessage(target, markdown('**Standalone Markdown**'));
    await bot.app.client.sendMessage(
      target,
      markdown('**Raw format**', {
        keyboard: keyboard([
          [
            button.link('Docs', 'https://example.invalid', { id: 'docs', visitedLabel: 'Opened' }),
            button.command('Run', '/hello', {
              id: 'run',
              enter: true,
              style: 'primary',
              permission: { type: 'users', userIds: ['user'] },
            }),
            button.callback('callback', 'Choose', 'choice'),
          ],
        ]),
      }),
    );
    assert.deepEqual(bot.messages[0]?.payload, {
      msg_type: 2,
      markdown: {
        content: '**Standalone Markdown**',
      },
    });
    const payload = bot.messages[1]?.payload;
    assert.ok(payload?.msg_type === 2 && payload.keyboard?.content);
    const buttons = payload.keyboard.content.rows[0]?.buttons;
    assert.deepEqual(
      buttons?.map((button) => button.action.type),
      [0, 2, 1],
    );
    assert.deepEqual(
      buttons?.map((button) => button.render_data.visited_label),
      ['Opened', 'Run', 'Choose'],
    );
    assert.equal(buttons?.[1]?.action.enter, true);
    assert.deepEqual(buttons?.[1]?.action.permission, { type: 0, specify_user_ids: ['user'] });
  } finally {
    await bot.app.close();
  }
});
