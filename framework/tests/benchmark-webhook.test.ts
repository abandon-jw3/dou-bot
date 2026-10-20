import assert from 'node:assert/strict';
import test from 'node:test';
import { Command, Controller, Module } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { MemoryPersistence } from '../src/testing/memory-persistence.js';
import { createFixtures } from '../src/testing/fixtures.js';
import { accountIds, profile, secret, signedHeaders } from '../examples/mixed-benchmark/common.js';
import { serve, until } from './helpers.js';

await test('benchmark Webhook headers authenticate both account paths and reject a mismatched account', async () => {
  @Controller()
  class Commands {
    @Command('ping') ping(): string {
      return 'pong';
    }
  }
  @Module({ controllers: [Commands] })
  class Root {}
  const ids = accountIds({ ...profile('smoke'), bots: 2 });
  const fixture = createFixtures({});
  const app = await Application.create(
    Root,
    {
      database: { host: 'localhost', user: 'offline', password: '', database: 'offline' },
      bots: ids.map((appId) => ({
        appId,
        secret,
        transport: { type: 'webhook', path: `/qq/${appId}` },
      })),
      webhook: { listen: false },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    },
    { persistence: new MemoryPersistence(), fetch: fixture.fetcher },
  );
  const host = await serve(app.webhookHandler());
  try {
    await app.start();
    for (const id of ids) {
      const body = Buffer.from(
        JSON.stringify({
          op: 0,
          t: 'C2C_MESSAGE_CREATE',
          d: { id: id + '-message', content: '/ping', author: { user_openid: 'fixture-user' } },
        }),
      );
      const response = await fetch(`${host.url}/qq/${id}`, {
        method: 'POST',
        headers: signedHeaders(body, id),
        body,
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    await until(() => fixture.botMessages.length === 2);
    assert.deepEqual(fixture.botMessages.map((message) => message.appId).sort(), [...ids].sort());
    const body = Buffer.from(
      JSON.stringify({
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: { id: 'mismatch', content: '/ping', author: { user_openid: 'fixture-user' } },
      }),
    );
    const rejected = await fetch(`${host.url}/qq/${ids[1]}`, {
      method: 'POST',
      headers: signedHeaders(body, ids[0]),
      body,
    });
    assert.equal(rejected.status, 403);
    await rejected.arrayBuffer();
    assert.equal(fixture.botMessages.length, 2);
  } finally {
    await app.close();
    await host.close();
  }
});
