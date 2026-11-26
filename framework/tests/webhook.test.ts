import type { TestApplication as BotApplication } from '../src/testing/single-bot.js';
import { SingleTestApplication as BotFactory } from '../src/testing/single-bot.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { Agent, request as httpRequest } from 'node:http';
import { Command, Controller, Module } from '../src/index.js';
import type { WebhookTransportOptions } from '../src/index.js';
import { deferred, qqServer, serve, until } from './helpers.js';
import { SingleTestApplication as Application } from '../src/testing/single-bot.js';
import { FakeClock } from './fake-clock.js';

const secret = '0123456789abcdef';
const key = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(secret.repeat(2)),
  ]),
  format: 'der',
  type: 'pkcs8',
});
function signedHeaders(body: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  return {
    'content-type': 'application/json',
    'x-bot-appid': 'fixture-app',
    'x-signature-timestamp': timestamp,
    'x-signature-ed25519': sign(null, Buffer.from(timestamp + body), key).toString('hex'),
  };
}
const silent = { debug() {}, info() {}, warn() {}, error() {} };

await test('authenticated overload reuses HTTP connections and recovers without admitting extra work', async () => {
  const gate = deferred<void>();
  let executed = 0;
  @Controller()
  class Commands {
    @Command('hold') async hold(): Promise<void> {
      executed++;
      await gate.promise;
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const app = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret,
      logger: silent,
      transport: { type: 'webhook', listen: false },
      execution: { concurrency: 1, queueCapacity: 1 },
    },
    { fetch: () => Promise.resolve(Response.json({ access_token: 'fixture', expires_in: 7200 })) },
  );
  const host = await serve(app.webhookHandler());
  const agent = new Agent({ keepAlive: true, maxSockets: 1 });
  let connections = 0;
  host.server.on('connection', () => {
    connections++;
  });
  const dispatch = async (id: string, invalid = false) => {
    const body = JSON.stringify({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id, content: '/hold', author: { user_openid: 'user' } },
    });
    const headers = { ...signedHeaders(body), 'content-length': String(Buffer.byteLength(body)) };
    if (invalid) headers['x-signature-ed25519'] = '0'.repeat(128);
    return await new Promise<{ status: number | undefined; connection: string | undefined }>(
      (resolve, reject) => {
        const request = httpRequest(
          host.url + '/qq',
          { method: 'POST', agent, headers },
          (response) => {
            response.resume();
            response.once('error', reject);
            response.once('end', () =>
              resolve({ status: response.statusCode, connection: response.headers.connection }),
            );
          },
        );
        request.once('error', reject);
        request.end(body);
      },
    );
  };
  await app.start();
  try {
    assert.equal((await dispatch('active')).status, 200);
    assert.equal((await dispatch('queued')).status, 200);
    for (let i = 0; i < 100; i++) assert.equal((await dispatch(`overflow-${i}`)).status, 503);
    assert.equal(connections, 1, 'Every overload response must remain reusable');
    assert.equal(executed, 1);
    assert.equal(app.snapshot().queue.pending, 1);
    assert.equal(app.snapshot().events.accepted, 2);
    assert.equal(app.snapshot().rejections.queueFull, 100);
    gate.resolve();
    await app.execution.idle();
    assert.equal((await dispatch('recovered')).status, 200);
    await app.execution.idle();
    assert.equal(connections, 1);
    assert.equal(executed, 3);
    const rejected = await dispatch('invalid', true);
    assert.equal(rejected.status, 403);
    assert.equal(rejected.connection, 'close');
    assert.equal((await dispatch('after-invalid')).status, 200);
    assert.equal(connections, 2);
  } finally {
    gate.resolve();
    agent.destroy();
    await app.close();
    await host.close();
  }
});
async function webhook(root: new () => object, extra: Partial<WebhookTransportOptions> = {}) {
  const backend = await qqServer();
  const app = await BotFactory.create(root, {
    appId: 'fixture-app',
    secret,
    logger: silent,
    api: { baseUrl: backend.url, tokenEndpoint: backend.url + '/app/getAppAccessToken' },
    transport: { type: 'webhook', listen: false, ...extra },
  });
  const handler = app.webhookHandler();
  const host = await serve((request, response) => {
    if (request.url === '/health') {
      response.end('healthy');
      return;
    }
    handler(request, response);
  });
  return {
    app,
    backend,
    url: host.url,
    close: async () => {
      await app.close();
      await host.close();
      await backend.close();
    },
  };
}
async function post(
  url: string,
  body: string,
  headers: Record<string, string> = signedHeaders(body),
): Promise<Response> {
  return await fetch(url + '/qq', { method: 'POST', body, headers });
}

await test('Webhook preserves signed raw bytes and acknowledges before a slow command completes', async () => {
  const gate = deferred<void>();
  @Controller()
  class Commands {
    @Command('slow') async slow(): Promise<string> {
      await gate.promise;
      return 'done';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const fixture = await webhook(Root);
  await fixture.app.start();
  try {
    const body =
      '{ "op":0, "t":"C2C_MESSAGE_CREATE", "d": {"id":"m", "author":{"id":"u"}, "content":"/slow"}}';
    const first = await post(fixture.url, body);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { op: 12, d: {} });
    assert.equal(fixture.backend.messages.length, 0);
    assert.equal((await post(fixture.url, body)).status, 200);
    gate.resolve();
    await until(() => fixture.backend.messages.length === 1);
    assert.equal(fixture.app.snapshot().events.duplicates, 1);
  } finally {
    gate.resolve();
    await fixture.close();
  }
});

await test('invalid signatures, replay timestamps and wrong applications cannot reach handlers', async () => {
  @Controller()
  class Commands {
    @Command('hello') hello(): string {
      return 'hello';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const fixture = await webhook(Root);
  await fixture.app.start();
  try {
    const body = JSON.stringify({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: 'm', author: { id: 'u' }, content: '/hello' },
    });
    assert.equal((await post(fixture.url, body + ' ', signedHeaders(body))).status, 403);
    assert.equal((await post(fixture.url, body, { 'x-bot-appid': 'fixture-app' })).status, 403);
    assert.equal(
      (await post(fixture.url, body, { ...signedHeaders(body), 'x-bot-appid': 'different' }))
        .status,
      403,
    );
    assert.equal((await post(fixture.url, body, signedHeaders(body, '1725442341'))).status, 403);
    assert.equal(
      (
        await post(
          fixture.url,
          body,
          signedHeaders(body, String(Math.floor(Date.now() / 1000) + 3600)),
        )
      ).status,
      403,
    );
    assert.equal(fixture.backend.messages.length, 0);
  } finally {
    await fixture.close();
  }
});

await test('challenge signing works for an opaque token but cannot sign an arbitrary Dispatch', async () => {
  @Module({})
  class Root {}
  const fixture = await webhook(Root);
  await fixture.app.start();
  try {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const token = 'OpaqueFixtureToken';
    const response = await post(
      fixture.url,
      JSON.stringify({ op: 13, d: { event_ts: timestamp, plain_token: token } }),
      { 'x-bot-appid': 'fixture-app' },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      plain_token: token,
      signature: sign(null, Buffer.from(timestamp + token), key).toString('hex'),
    });
    const attack = JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { content: '/fixture' } });
    const blocked = await post(
      fixture.url,
      JSON.stringify({ op: 13, d: { event_ts: timestamp, plain_token: attack } }),
      { 'x-bot-appid': 'fixture-app' },
    );
    assert.equal(blocked.status, 400);
    assert.equal((await post(fixture.url, JSON.stringify([]), signedHeaders('[]'))).status, 400);
  } finally {
    await fixture.close();
  }
});

await test('Webhook body limits and host server ownership are respected', async () => {
  @Module({})
  class Root {}
  const fixture = await webhook(Root, { maxBodyBytes: 32 });
  await fixture.app.start();
  try {
    const response = await post(fixture.url, 'x'.repeat(64));
    assert.equal(response.status, 413);
    assert.equal(response.headers.get('connection'), 'close');
    assert.equal((await fetch(fixture.url + '/health')).status, 200);
    await fixture.app.close();
    assert.equal((await fetch(fixture.url + '/health')).status, 200);
    assert.equal((await post(fixture.url, '{}')).status, 503);
  } finally {
    await fixture.close();
  }
});

await test('a slow incomplete body consumes one slot and times out without crashing the host', async () => {
  @Module({})
  class Root {}
  const backend = await qqServer();
  const app: BotApplication = await BotFactory.create(Root, {
    appId: 'fixture-app',
    secret,
    logger: silent,
    api: { baseUrl: backend.url, tokenEndpoint: backend.url + '/app/getAppAccessToken' },
    transport: { type: 'webhook', listen: false, readTimeoutMs: 100, maxConcurrentRequests: 1 },
  });
  const entered = deferred<void>();
  const handler = app.webhookHandler();
  const host = await serve((request, response) => {
    handler(request, response);
    if (request.url === '/qq?slow') entered.resolve();
  });
  await app.start();
  const timedOut = deferred<number | undefined>();
  const slow = httpRequest(
    host.url + '/qq?slow',
    { method: 'POST', headers: { 'x-bot-appid': 'fixture-app', 'content-length': '500' } },
    (response) => {
      response.resume();
      timedOut.resolve(response.statusCode);
    },
  );
  slow.on('error', () => {});
  try {
    slow.write('{');
    await entered.promise;
    assert.equal((await post(host.url, '{}')).status, 503);
    assert.equal(await timedOut.promise, 408);
  } finally {
    slow.destroy();
    await app.close();
    await host.close();
    await backend.close();
  }
});

await test('a client abort during body reading releases its slot and does not leave an unhandled stream error', async () => {
  @Module({})
  class Root {}
  const fixture = await webhook(Root, { maxConcurrentRequests: 1 });
  await fixture.app.start();
  const incomplete = httpRequest(fixture.url + '/qq', {
    method: 'POST',
    headers: { 'x-bot-appid': 'fixture-app', 'content-length': '500' },
  });
  incomplete.on('error', () => {});
  try {
    incomplete.write('{');
    let overloaded = false;
    for (let attempt = 0; attempt < 20 && !overloaded; attempt++) {
      const response = await post(fixture.url, '{}');
      overloaded = response.status === 503;
      if (overloaded) assert.equal(response.headers.get('connection'), 'close');
    }
    assert.equal(overloaded, true);
    incomplete.destroy();
    let status = 503;
    for (let attempt = 0; attempt < 20 && status === 503; attempt++)
      status = (await post(fixture.url, '{}')).status;
    assert.equal(status, 400);
    assert.equal((await fetch(fixture.url + '/health')).status, 200);
  } finally {
    incomplete.destroy();
    await fixture.close();
  }
});

await test('shared Webhook shutdown closes incomplete HTTP connections within the shared deadline', async () => {
  @Module({})
  class Root {}
  const reservation = await serve((_request, response) => response.end());
  const address = new URL(reservation.url);
  await reservation.close();
  const clock = new FakeClock();
  const app = await Application.create(
    Root,
    {
      appId: 'fixture-app',
      secret,
      logger: silent,
      transport: {
        type: 'webhook',
        host: '127.0.0.1',
        port: Number(address.port),
        readTimeoutMs: 5000,
      },
      execution: { shutdownTimeoutMs: 100 },
    },
    {
      clock,
      fetch: () =>
        Promise.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 })),
    },
  );
  await app.start();
  const incomplete = httpRequest(address.href + 'qq', {
    method: 'POST',
    headers: { 'x-bot-appid': 'fixture-app', 'content-length': '500' },
  });
  incomplete.on('error', () => {});
  incomplete.write('{');
  try {
    // The token refresh timer plus read timer prove the incomplete request entered the handler.
    await until(() => clock.pending === 2);
    const closing = app.close();
    await clock.advance(100);
    await closing;
    await until(() => incomplete.destroyed);
    await clock.flush();
    assert.equal(app.status, 'stopped');
    assert.equal(clock.pending, 0);
    await assert.rejects(fetch(address.href + 'qq', { method: 'POST', body: '{}' }));
  } finally {
    incomplete.destroy();
    await app.close().catch(() => {});
  }
});

await test('duplicate identity or signature headers are rejected even when their values agree', async () => {
  @Module({})
  class Root {}
  const fixture = await webhook(Root);
  await fixture.app.start();
  try {
    const body = JSON.stringify({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: 'm', author: { id: 'u' }, content: '/unknown' },
    });
    const headers = signedHeaders(body);
    for (const repeated of ['x-bot-appid', 'x-signature-timestamp', 'x-signature-ed25519']) {
      const rawHeaders = Object.entries(headers).flat();
      rawHeaders.push(
        'Host',
        new URL(fixture.url).host,
        'Content-Length',
        String(Buffer.byteLength(body)),
      );
      rawHeaders.push(repeated.toUpperCase(), headers[repeated as keyof typeof headers]);
      const status = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          fixture.url + '/qq',
          { method: 'POST', headers: rawHeaders },
          (response) => {
            response.resume();
            response.once('end', () => resolve(response.statusCode));
          },
        );
        request.once('error', reject);
        request.end(body);
      });
      assert.equal(status, 403, repeated);
    }
  } finally {
    await fixture.close();
  }
});

await test('Webhook distinguishes malformed input from an unexpected implementation failure', async (context) => {
  @Module({})
  class Root {}
  const fixture = await webhook(Root);
  await fixture.app.start();
  try {
    assert.equal((await fetch(fixture.url + '/qq')).status, 405);
    assert.equal((await fetch(fixture.url + '/other')).status, 404);
    assert.equal(
      (await post(fixture.url, '{}', { 'x-bot-appid': 'fixture-app', 'content-encoding': 'gzip' }))
        .status,
      415,
    );
    assert.equal((await post(fixture.url, '{')).status, 400);
    const invalid = JSON.stringify({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'm', author: {} } });
    assert.equal((await post(fixture.url, invalid)).status, 200);
    assert.equal(fixture.app.snapshot().events.rejected, 1);
    assert.ok(fixture.app instanceof Application);
    context.mock.method(fixture.app.execution, 'accept', () => {
      throw new Error('unexpected fixture bug');
    });
    const response = await post(fixture.url, invalid);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {});
  } finally {
    await fixture.close();
  }
});
