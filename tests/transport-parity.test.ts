import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import {
  Arg,
  Attachments,
  Audios,
  BotFactory,
  Command,
  Controller,
  Ctx,
  Files,
  Group,
  GroupId,
  GroupManagersOnly,
  Injectable,
  Images,
  Module,
  OnButton,
  Role,
  User,
  UserId,
  Videos,
  button,
  image,
  keyboard,
  markdown,
} from '../src/index.js';
import type {
  Attachment,
  ButtonContext,
  CanActivate,
  GuardContext,
  GuardResult,
  GroupInfo,
  GroupRole,
  MessageContext,
  QQDispatch,
  UserInfo,
} from '../src/index.js';
import { qqServer, serve, until } from './helpers.js';

await test('identical private/group messages and buttons produce identical behavior through real WS and Webhook HTTP', async () => {
  @Injectable()
  class ModuleGate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      return ctx.userId !== 'blocked' || { allow: false, message: 'module denied' };
    }
  }
  @Controller()
  class Commands {
    readonly calls: string[] = [];
    readonly identities: unknown[] = [];
    identity(
      user: UserInfo,
      userId: string,
      group: GroupInfo | undefined,
      groupId: string | undefined,
      role: GroupRole | undefined,
    ): string {
      assert.ok(Object.isFrozen(user));
      assert.ok(group === undefined || Object.isFrozen(group));
      const result = { user, userId, group, groupId, role };
      this.identities.push(result);
      return JSON.stringify(result);
    }
    @Command('identity') who(
      @User() user: UserInfo,
      @UserId() userId: string,
      @Group() group: GroupInfo | undefined,
      @GroupId() groupId: string | undefined,
      @Role() role: GroupRole | undefined,
    ): string {
      return this.identity(user, userId, group, groupId, role);
    }
    @OnButton('identity') async whoClicked(
      @Role() role: GroupRole | undefined,
      @GroupId() groupId: string | undefined,
      @User() user: UserInfo,
      @Group() group: GroupInfo | undefined,
      @UserId() userId: string,
      @Ctx() ctx: ButtonContext,
    ): Promise<void> {
      await ctx.ack();
      await ctx.send(this.identity(user, userId, group, groupId, role));
    }
    @Command('prompt')
    async prompt(@Ctx() ctx: MessageContext): Promise<void> {
      const answer = await ctx.prompt('prompt-question');
      if (answer.status === 'received') {
        this.calls.push(`prompt:${answer.message.content}`);
        await answer.message.reply(`prompt-answer:${answer.message.content}`);
      }
    }
    @Command('manage')
    @GroupManagersOnly({ message: 'denied' })
    manage(@Ctx() ctx: MessageContext) {
      const role = ctx.scene === 'group' ? ctx.memberRole : undefined;
      this.calls.push(`manage:${role}`);
      return markdown(`manager:${role}`, {
        keyboard: keyboard([
          [button.callback('press', '管理', 'managed', { permission: { type: 'managers' } })],
        ]),
      });
    }
    @Command('echo') echo(@Arg(0) text: string, @Ctx() ctx: MessageContext): string {
      this.calls.push(`${ctx.scene}:echo:${text}`);
      return text;
    }
    @Command('image') picture(@Ctx() ctx: MessageContext) {
      this.calls.push(`${ctx.scene}:image`);
      return image(new Uint8Array([1, 2, 3]));
    }
    @Command('markdown') formatted(@Ctx() ctx: MessageContext) {
      this.calls.push(`${ctx.scene}:markdown`);
      return markdown('**same**', {
        keyboard: keyboard([[button.callback('press', 'Press', 'choice')]]),
      });
    }
    @Command('attachments') attachments(
      @Attachments() all: readonly Attachment[],
      @Images() images: readonly Attachment[],
      @Videos() videos: readonly Attachment[],
      @Audios() audios: readonly Attachment[],
      @Files() files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
    ): string {
      this.calls.push(`${ctx.scene}:attachments`);
      return JSON.stringify({
        counts: [all.length, images.length, videos.length, audios.length, files.length],
        wav: audios[0]?.voiceWavUrl,
        asr: audios[0]?.asrReferText,
      });
    }
    @OnButton('press') async pressed(@Ctx() ctx: ButtonContext): Promise<void> {
      this.calls.push(`${ctx.scene}:button:${ctx.data}`);
      await ctx.ack();
      await ctx.send('selected');
    }
  }
  @Module({ controllers: [Commands], providers: [ModuleGate], guards: [ModuleGate] })
  class Root {}
  const secret = '0123456789abcdef';
  const backends = [await qqServer(), await qqServer()];
  const errors: Error[] = [];
  const apps = await Promise.all(
    backends.map((backend, index) =>
      BotFactory.create(Root, {
        appId: 'fixture-app',
        secret,
        execution: { concurrency: 1 },
        api: { baseUrl: backend.url, tokenEndpoint: backend.url + '/app/getAppAccessToken' },
        transport:
          index === 0 ? { type: 'ws', closeTimeoutMs: 50 } : { type: 'webhook', listen: false },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
        onError(error) {
          errors.push(error);
        },
      }),
    ),
  );
  const ws = apps[0];
  const webhook = apps[1];
  const wsBackend = backends[0];
  const hookBackend = backends[1];
  assert.ok(ws && webhook && wsBackend && hookBackend);
  const host = await serve(webhook.webhookHandler());
  const key = createPrivateKey({
    key: Buffer.concat([
      Buffer.from('302e020100300506032b657004220420', 'hex'),
      Buffer.from(secret.repeat(2)),
    ]),
    format: 'der',
    type: 'pkcs8',
  });
  const events: QQDispatch[] = [
    {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: 'private', author: { user_openid: 'user' }, content: '/echo "hello world"' },
    },
    {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'group',
        group_openid: 'group',
        author: { member_openid: 'member' },
        content: '<@self> /echo group',
        mentions: [{ id: 'self', is_you: true }],
      },
    },
    {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: 'picture', author: { id: 'user' }, content: '/image' },
    },
    {
      op: 0,
      t: 'GROUP_AT_MESSAGE_CREATE',
      d: { id: 'formatted', group_id: 'group', author: { id: 'member' }, content: ' /markdown' },
    },
    {
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'private-button',
        chat_type: 2,
        user_openid: 'user',
        data: { resolved: { button_id: 'press', button_data: 'private' } },
      },
    },
    {
      op: 0,
      t: 'INTERACTION_CREATE',
      d: {
        id: 'group-button',
        chat_type: 1,
        group_openid: 'group',
        group_member_openid: 'member',
        data: { resolved: { button_id: 'press', button_data: 'group' } },
      },
    },
  ];
  for (const [index, role] of ['owner', 'member', undefined, 'admin'].entries()) {
    events.push({
      op: 0,
      t: index === 3 ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
      d: {
        id: `role-${index}`,
        group_openid: 'group',
        author: { member_openid: 'member', ...(role === undefined ? {} : { member_role: role }) },
        content: '/manage',
      },
    });
  }
  events.push(
    {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'prompt-start',
        group_openid: 'group',
        author: { member_openid: 'member' },
        content: '/prompt',
      },
    },
    {
      op: 0,
      t: 'GROUP_MESSAGE_CREATE',
      d: {
        id: 'prompt-answer',
        group_openid: 'group',
        author: { member_openid: 'member' },
        content: 'plain input',
      },
    },
  );
  events.push({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'module-blocked',
      author: { user_openid: 'blocked' },
      content: '/echo should-not-run',
    },
  });
  for (const scene of ['private', 'group']) {
    events.push({
      op: 0,
      t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE',
      d: {
        id: `attachments-${scene}`,
        ...(scene === 'private'
          ? { author: { user_openid: 'user' } }
          : { author: { member_openid: 'member' }, group_openid: 'group' }),
        content: '/attachments',
        attachments: [
          { url: 'https://example.invalid/image.png', content_type: 'image/png' },
          { url: 'https://example.invalid/video.mp4', content_type: 'video/mp4' },
          {
            url: 'https://example.invalid/voice.silk',
            content_type: 'voice',
            voice_wav_url: 'https://example.invalid/voice.wav',
            asr_refer_text: '/echo not-a-command',
          },
          { url: 'https://example.invalid/file', content_type: 'file' },
        ],
        msg_elements: [
          {
            attachments: [{ url: 'https://example.invalid/quoted.png', content_type: 'image/png' }],
          },
        ],
      },
    });
  }
  for (const scene of ['private', 'group']) {
    events.push(
      {
        op: 0,
        t: scene === 'private' ? 'C2C_MESSAGE_CREATE' : 'GROUP_AT_MESSAGE_CREATE',
        d: {
          id: `identity-${scene}`,
          content: '/identity',
          ...(scene === 'private'
            ? { author: { user_openid: 'user', username: '', bot: false } }
            : {
                group_openid: 'group',
                author: {
                  member_openid: 'member',
                  username: '群员',
                  bot: false,
                  member_role: 'admin',
                },
              }),
        },
      },
      {
        op: 0,
        t: 'INTERACTION_CREATE',
        d: {
          id: `identity-button-${scene}`,
          chat_type: scene === 'private' ? 2 : 1,
          ...(scene === 'private'
            ? { user_openid: 'user' }
            : { group_openid: 'group', group_member_openid: 'member' }),
          data: { resolved: { button_id: 'identity' } },
          author: { username: 'not-an-author', member_role: 'owner' },
        },
      },
    );
  }
  try {
    await Promise.all(apps.map((app) => app.start()));
    for (const [index, event] of events.entries()) {
      wsBackend.sockets[0]?.send(JSON.stringify({ ...event, s: index + 2 }));
      const body = JSON.stringify(event, null, 2);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const response = await fetch(host.url + '/qq', {
        method: 'POST',
        body,
        headers: {
          'content-type': 'application/json',
          'x-bot-appid': 'fixture-app',
          'x-signature-timestamp': timestamp,
          'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), key).toString('hex'),
        },
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { op: 12, d: {} });
      await until(() => backends.every((backend) => backend.messages.length === index + 1));
    }
    assert.deepEqual(ws.get(Commands).calls, webhook.get(Commands).calls);
    assert.deepEqual(wsBackend.messages, hookBackend.messages);
    assert.deepEqual(wsBackend.messagePaths, hookBackend.messagePaths);
    assert.deepEqual(wsBackend.messagePaths, [
      '/v2/users/user/messages',
      '/v2/groups/group/messages',
      '/v2/users/user/messages',
      '/v2/groups/group/messages',
      '/v2/users/user/messages',
      '/v2/groups/group/messages',
      ...Array<string>(6).fill('/v2/groups/group/messages'),
      '/v2/users/blocked/messages',
      '/v2/users/user/messages',
      '/v2/groups/group/messages',
      '/v2/users/user/messages',
      '/v2/users/user/messages',
      '/v2/groups/group/messages',
      '/v2/groups/group/messages',
    ]);
    assert.equal(
      wsBackend.messages[6]?.keyboard?.content.rows[0]?.buttons[0]?.action.permission.type,
      1,
    );
    assert.equal(wsBackend.messages[7]?.content, 'denied');
    assert.equal(wsBackend.messages[8]?.content, 'denied');
    assert.equal(wsBackend.messages[9]?.markdown?.content, 'manager:admin');
    assert.equal(wsBackend.messages[10]?.content, 'prompt-question');
    assert.equal(wsBackend.messages[11]?.msg_id, 'prompt-answer');
    assert.equal(wsBackend.messages[11]?.content, 'prompt-answer:plain input');
    assert.equal(wsBackend.messages[12]?.content, 'module denied');
    for (const index of [13, 14]) {
      const result: unknown = JSON.parse(wsBackend.messages[index]?.content ?? 'null');
      assert.deepEqual(result, {
        counts: [4, 1, 1, 1, 1],
        wav: 'https://example.invalid/voice.wav',
        asr: '/echo not-a-command',
      });
    }
    assert.deepEqual(ws.get(Commands).identities, webhook.get(Commands).identities);
    assert.deepEqual(
      wsBackend.messages.slice(15).map((entry) => JSON.parse(entry.content ?? 'null') as unknown),
      [
        { user: { id: 'user', username: '', bot: false }, userId: 'user' },
        { user: { id: 'user' }, userId: 'user' },
        {
          user: { id: 'member', username: '群员', bot: false, memberRole: 'admin' },
          userId: 'member',
          group: { id: 'group' },
          groupId: 'group',
          role: 'admin',
        },
        { user: { id: 'member' }, userId: 'member', group: { id: 'group' }, groupId: 'group' },
      ],
    );
    assert.equal(
      ws.get(Commands).calls.some((call) => call.includes('should-not-run')),
      false,
    );
    await until(() =>
      apps.every(
        (app) => app.snapshot().prompts.pending === 0 && app.snapshot().queue.active === 0,
      ),
    );
    assert.equal(wsBackend.messages[4]?.msg_id, undefined);
    assert.equal(wsBackend.messages[5]?.event_id, undefined);
    assert.deepEqual(errors, []);
    assert.deepEqual(wsBackend.failures, []);
    assert.deepEqual(hookBackend.failures, []);
  } finally {
    await Promise.all(apps.map((app) => app.close()));
    await host.close();
    await Promise.all(backends.map((backend) => backend.close()));
  }
});
