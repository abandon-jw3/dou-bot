import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { Arg, BotFactory, Command, Controller, FrameworkError, Module } from '../src/index.js';
import type { BotOptions, QQDispatch, WsTransportOptions } from '../src/index.js';
import { deferred, qqServer, until } from './helpers.js';
import { Application } from '../src/core/application.js';
import { FakeClock } from './fake-clock.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
function configuration(
  url: string,
  transport: Partial<WsTransportOptions> = {},
  options: Partial<BotOptions> = {},
): BotOptions {
  return {
    appId: 'fixture-app',
    secret: 'fixture-secret',
    logger: silent,
    api: { baseUrl: url, tokenEndpoint: url + '/app/getAppAccessToken' },
    transport: {
      type: 'ws',
      connectTimeoutMs: 1000,
      closeTimeoutMs: 30,
      retry: { initialAttempts: 1, baseDelayMs: 10, maxDelayMs: 20 },
      ...transport,
    },
    ...options,
  };
}
function message(id: string, sequence: number, content = '/echo fixture'): QQDispatch {
  return { op: 0, t: 'C2C_MESSAGE_CREATE', s: sequence, d: { id, author: { id: 'u' }, content } };
}
@Controller()
class Echo {
  @Command('echo') echo(@Arg(0) value: string): string {
    return value;
  }
}
@Module({ controllers: [Echo] })
class Root {}

for (const field of ['s', 'd'] as const) {
  await test(`WS identifies with upgrade headers, handles messages, and uses ${field} heartbeat format`, async () => {
    const backend = await qqServer();
    const app = await BotFactory.create(
      Root,
      configuration(backend.url, { heartbeatSequenceField: field }),
    );
    try {
      await app.start();
      backend.sockets[0]?.send(JSON.stringify(message('first', 2)));
      await until(
        () => backend.messages.length === 1 && backend.frames.some((item) => item.frame.op === 1),
      );
      assert.equal(backend.upgrades[0]?.authorization, 'QQBot fixture-token');
      assert.equal(backend.upgrades[0]?.appId, 'fixture-app');
      assert.equal(backend.messages[0]?.content, 'fixture');
      assert.equal(backend.messagePaths[0], '/v2/users/u/messages');
      const heartbeat = backend.frames.find((item) => item.frame.op === 1)?.frame;
      assert.equal(heartbeat?.[field], 2);
      assert.equal(heartbeat?.[field === 's' ? 'd' : 's'], undefined);
      backend.sockets[0]?.send(
        JSON.stringify({
          op: 0,
          t: 'GROUP_AT_MESSAGE_CREATE',
          s: 3,
          d: {
            id: 'group',
            group_openid: 'g',
            author: { member_openid: 'member' },
            content: '/echo group',
          },
        }),
      );
      await until(() => backend.messages.length === 2);
      assert.equal(backend.messagePaths[1], '/v2/groups/g/messages');
      backend.sockets[0]?.send(
        JSON.stringify({
          op: 0,
          t: 'GROUP_MESSAGE_CREATE',
          s: 4,
          d: {
            id: 'full-group',
            group_openid: 'g',
            author: { member_openid: 'member' },
            content: '<@self-openid> /echo mentioned',
            mentions: [{ id: 'self-openid', is_you: true }],
          },
        }),
      );
      await until(() => backend.messages.length === 3);
      assert.equal(backend.messages[2]?.content, 'mentioned');
      assert.equal(backend.messagePaths[2], '/v2/groups/g/messages');
      assert.equal(backend.tokenRequests, 1);
      assert.deepEqual(backend.failures, []);
    } finally {
      await app.close();
      await backend.close();
    }
  });
}

await test('missing heartbeat acknowledgments reconnect using RESUME without repeatedly discovering the gateway', async () => {
  const backend = await qqServer({ heartbeatInterval: 15, acknowledgeHeartbeats: false });
  const app = await BotFactory.create(Root, configuration(backend.url));
  try {
    await app.start();
    await until(() => backend.frames.some((item) => item.connection === 2 && item.frame.op === 6));
    const resume = backend.frames.find((item) => item.frame.op === 6)?.frame;
    assert.deepEqual(resume?.d, {
      token: 'QQBot fixture-token',
      session_id: 'fixture-session',
      seq: 1,
    });
    assert.equal(backend.gatewayRequests, 1);
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('overload freezes the accepted cursor and blocks higher frames until capacity returns', async () => {
  const gate = deferred<void>();
  @Controller()
  class Waiter {
    @Command('wait') async wait(): Promise<string> {
      await gate.promise;
      return 'done';
    }
  }
  @Module({ controllers: [Waiter] })
  class WaitRoot {}
  const backend = await qqServer({
    heartbeatInterval: 1000,
    onFrame: (socket, frame) => {
      if (frame.op === 6) {
        socket.send(JSON.stringify(message('m2', 3, '/wait')));
        socket.send(JSON.stringify(message('m3', 4, '/wait')));
        socket.send(JSON.stringify(message('m4', 5, '/wait')));
      }
    },
  });
  const app = await BotFactory.create(
    WaitRoot,
    configuration(backend.url, {}, { execution: { concurrency: 1, queueCapacity: 1 } }),
  );
  try {
    await app.start();
    const first = backend.sockets[0];
    assert.ok(first);
    for (let i = 1; i <= 4; i++) first.send(JSON.stringify(message(`m${i}`, i + 1, '/wait')));
    await until(() => first.readyState === WebSocket.CLOSED);
    assert.equal(app.snapshot().events.accepted, 2);
    gate.resolve();
    await until(() => backend.messages.length === 4);
    const resume = backend.frames.find((item) => item.frame.op === 6)?.frame;
    assert.deepEqual(resume?.d, {
      token: 'QQBot fixture-token',
      session_id: 'fixture-session',
      seq: 3,
    });
    assert.deepEqual(
      backend.messages.map((item) => item.msg_id),
      ['m1', 'm2', 'm3', 'm4'],
    );
    assert.equal(app.snapshot().events.duplicates, 1);
  } finally {
    gate.resolve();
    await app.close();
    await backend.close();
  }
});

await test('invalid sessions reset the resume state and identify again', async () => {
  const backend = await qqServer();
  const app = await BotFactory.create(Root, configuration(backend.url));
  try {
    await app.start();
    backend.sockets[0]?.send(JSON.stringify({ op: 9, d: false }));
    await until(() => backend.frames.some((item) => item.connection === 2 && item.frame.op === 2));
    assert.equal(
      backend.frames.some((item) => item.connection === 2 && item.frame.op === 6),
      false,
    );
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('the startup promise rejects when HELLO never arrives and closes its socket', async () => {
  const backend = await qqServer({ hello: false });
  const app = await BotFactory.create(Root, configuration(backend.url, { connectTimeoutMs: 40 }));
  try {
    await assert.rejects(
      app.start(),
      (error: unknown) => error instanceof FrameworkError && error.code === 'TRANSPORT',
    );
    assert.equal(app.status, 'failed');
    await until(() => backend.sockets.every((socket) => socket.readyState === WebSocket.CLOSED));
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('oversized WS messages are rejected before business dispatch', async () => {
  const backend = await qqServer();
  const app = await BotFactory.create(
    Root,
    configuration(
      backend.url,
      { retry: { initialAttempts: 1, baseDelayMs: 1000, maxDelayMs: 1000 } },
      { execution: { maxEventBytes: 256 } },
    ),
  );
  try {
    await app.start();
    const first = backend.sockets[0];
    assert.ok(first);
    first.send(JSON.stringify(message('large', 2, '/echo ' + 'x'.repeat(1000))));
    await until(() => first.readyState === WebSocket.CLOSED);
    assert.equal(backend.messages.length, 0);
    assert.equal(app.snapshot().events.accepted, 0);
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('successful RESUME resets retry delay and stopping cancels all application timers', async () => {
  const backend = await qqServer({ heartbeatInterval: 60000 });
  const clock = new FakeClock();
  const app = await Application.create(Root, configuration(backend.url), {
    clock,
    random: () => 0.5,
  });
  try {
    await app.start();
    for (let iteration = 0; iteration < 3; iteration++) {
      const count: number = backend.sockets.length;
      backend.sockets.at(-1)?.send(JSON.stringify({ op: 7 }));
      await until(() => app.status === 'reconnecting');
      await clock.advance(9);
      assert.equal(backend.sockets.length, count);
      await clock.advance(1);
      await until(() => backend.sockets.length === count + 1 && app.status === 'running');
      assert.ok(
        backend.frames.some((item) => item.connection === count + 1 && item.frame.op === 6),
      );
    }
    assert.equal(backend.gatewayRequests, 1);
    assert.equal(backend.tokenRequests, 1);
    await app.close();
    await until(() => backend.sockets.every((socket) => socket.readyState === WebSocket.CLOSED));
    assert.equal(clock.pending, 0);
    await clock.advance(60000);
    assert.equal(backend.sockets.length, 4);
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('a WS socket ignoring close is terminated at the configured deadline and late frames are ignored', async () => {
  const backend = await qqServer({ heartbeatInterval: 60000 });
  const clock = new FakeClock();
  let client: WebSocket | undefined;
  let terminations = 0;
  const app = await Application.create(Root, configuration(backend.url, { closeTimeoutMs: 30 }), {
    clock,
    socketFactory: (url, options) => {
      client = new WebSocket(url, options);
      const terminate = client.terminate.bind(client);
      client.close = () => {};
      client.terminate = () => {
        terminations++;
        terminate();
      };
      return client;
    },
  });
  try {
    await app.start();
    let closed = false;
    const closing = app.close().then(() => {
      closed = true;
    });
    await clock.advance(29);
    assert.equal(closed, false);
    assert.equal(terminations, 0);
    await clock.advance(1);
    await closing;
    await until(() => client?.readyState === WebSocket.CLOSED);
    assert.ok(terminations >= 1);
    assert.ok(client);
    client.emit('message', Buffer.from(JSON.stringify(message('late', 2))));
    await clock.flush();
    assert.equal(backend.messages.length, 0);
    assert.equal(app.snapshot().events.accepted, 0);
    assert.equal(clock.pending, 0);
  } finally {
    await app.close();
    await backend.close();
  }
});

await test('initial connection failures stop at the configured attempt limit with no remaining timers', async () => {
  const clock = new FakeClock();
  let attempts = 0;
  const app = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret: 'fixture-secret',
      logger: silent,
      transport: {
        type: 'ws',
        gatewayUrl: 'wss://fixture.invalid',
        retry: { initialAttempts: 3, baseDelayMs: 10, maxDelayMs: 40 },
      },
    },
    {
      clock,
      random: () => 0.5,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
      socketFactory: () => {
        attempts++;
        throw new Error('fixture connect failure');
      },
    },
  );
  const starting = assert.rejects(app.start(), /initial connection attempts exhausted/);
  await clock.flush();
  assert.equal(attempts, 1);
  await clock.advance(10);
  assert.equal(attempts, 2);
  await clock.advance(20);
  await starting;
  assert.equal(attempts, 3);
  assert.equal(app.status, 'failed');
  assert.equal(clock.pending, 0);
  await clock.advance(60000);
  assert.equal(attempts, 3);
  await app.close();
});

await test('malformed gateway frames are classified without putting their contents in errors', async () => {
  const backend = await qqServer();
  const errors: Error[] = [];
  const app = await BotFactory.create(
    Root,
    configuration(
      backend.url,
      {},
      {
        onError(error) {
          errors.push(error);
        },
      },
    ),
  );
  try {
    await app.start();
    backend.sockets[0]?.send('private-frame-marker is not JSON');
    await until(() =>
      errors.some((error) => error instanceof FrameworkError && error.code === 'PROTOCOL'),
    );
    assert.ok(errors.every((error) => !error.message.includes('private-frame-marker')));
    await until(() => backend.sockets.length === 2 && app.status === 'running');
    assert.equal(backend.messages.length, 0);
    assert.equal(app.snapshot().events.accepted, 0);
  } finally {
    await app.close();
    await backend.close();
  }
});
