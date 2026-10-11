import test from 'node:test';
import assert from 'node:assert/strict';
import { Module, QQApiError, FrameworkError, image, markdown } from '../src/index.js';
import type { QQMessagePayload } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { deferred, serve } from './helpers.js';
import { Application } from '../src/core/application.js';

@Module({})
class Root {}

await test('concurrent requests share token acquisition and use the expected QQ headers', async () => {
  const token = deferred<Response>();
  let acquisitions = 0;
  const headers: Headers[] = [];
  const harness = await createTestApplication(Root, {
    respond: (request) => {
      if (request.url.pathname === '/app/getAppAccessToken') {
        acquisitions++;
        return token.promise;
      }
      headers.push(request.headers);
      if (request.url.pathname === '/gateway')
        return Response.json({ url: 'wss://example.invalid/gateway' });
      return undefined;
    },
  });
  try {
    const self = harness.app.client.getSelf();
    const gateway = harness.app.client.api.getGateway();
    token.resolve(Response.json({ access_token: 'fixture-shared', expires_in: '7200' }));
    await Promise.all([self, gateway]);
    assert.equal(acquisitions, 1);
    assert.ok(
      headers.every(
        (header) =>
          header.get('authorization') === 'QQBot fixture-shared' &&
          header.get('x-union-appid') === 'offline-app',
      ),
    );
  } finally {
    await harness.app.close();
  }
});

await test('origin escapes are rejected before credentials or HTTP requests are issued', async () => {
  let calls = 0;
  const harness = await createTestApplication(Root, {
    respond: () => {
      calls++;
      return undefined;
    },
  });
  try {
    for (const path of [
      '//example.invalid/collect',
      '/\\example.invalid/collect',
      'https://example.invalid',
      '/path#fragment',
      '/bad\npath',
    ]) {
      await assert.rejects(
        harness.app.client.api.request('GET', path),
        (error: unknown) => error instanceof FrameworkError && error.code === 'CONFIG',
      );
    }
    assert.equal(calls, 0);
  } finally {
    await harness.app.close();
  }
});

await test('HTTP success with QQ business failure still rejects and response trace is retained', async () => {
  const harness = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.endsWith('/messages')
        ? Response.json(
            { code: 123, message: 'fixture failure' },
            { headers: { 'x-tps-trace-id': 'trace-fixture' } },
          )
        : undefined,
  });
  try {
    await assert.rejects(
      harness.app.client.sendMessage({ scene: 'private', userId: 'u' }, 'hello'),
      (error: unknown) =>
        error instanceof QQApiError &&
        error.qqCode === 123 &&
        error.httpStatus === 200 &&
        error.traceId === 'trace-fixture',
    );
  } finally {
    await harness.app.close();
  }
});

await test('redirects, non-JSON send responses, and oversized responses are rejected', async () => {
  for (const response of [
    new Response(null, { status: 307, headers: { location: 'https://example.invalid/collect' } }),
    new Response('not-json', { status: 200 }),
    new Response('x'.repeat(200), { status: 200 }),
  ]) {
    let sends = 0;
    const harness = await createTestApplication(Root, {
      api: { maxResponseBytes: 128 },
      respond: (request) => {
        if (request.url.pathname.endsWith('/messages')) {
          sends++;
          return response;
        }
        return undefined;
      },
    });
    try {
      await assert.rejects(
        harness.app.client.sendMessage({ scene: 'private', userId: 'u' }, 'hello'),
      );
      assert.equal(sends, 1);
    } finally {
      await harness.app.close();
    }
  }
});

await test('an aborted request does not get silently retried', async () => {
  let sends = 0;
  const entered = deferred<void>();
  const harness = await createTestApplication(Root, {
    respond: (request) => {
      if (!request.url.pathname.endsWith('/messages')) return undefined;
      sends++;
      entered.resolve();
      return new Promise<Response>(() => {});
    },
  });
  const cancellation = new AbortController();
  try {
    const request = harness.app.client.sendMessage({ scene: 'private', userId: 'u' }, 'hello', {
      signal: cancellation.signal,
    });
    request.catch(() => {});
    await entered.promise;
    cancellation.abort(new Error('fixture cancellation'));
    await assert.rejects(request, /fixture cancellation/);
    assert.equal(sends, 1);
  } finally {
    await harness.app.close();
  }
});

await test('message auditing and uploaded image scope are explicit', async () => {
  const harness = await createTestApplication(Root, {
    respond: (request) =>
      request.url.pathname.endsWith('/messages')
        ? Response.json({ id: 'potential-message', audit_id: 'audit' })
        : undefined,
  });
  try {
    const result = await harness.app.client.sendMessage(
      { scene: 'private', userId: 'u' },
      markdown('**fixture**'),
    );
    assert.equal(result.status, 'pending-audit');
    const file = await harness.app.client.uploadImage(
      { scene: 'private', userId: 'u' },
      new Uint8Array([1, 2]),
    );
    await assert.rejects(
      harness.app.client.sendMessage({ scene: 'group', groupId: 'g' }, image(file)),
      /different bot, origin or target/,
    );
    await assert.rejects(
      harness.app.client.sendMessage(file.target, image({ ...file, appId: 'different' })),
      /different bot/,
    );
    await assert.rejects(
      harness.app.client.sendMessage(file.target, image({ ...file, expiresAt: 1 })),
      /expired/,
    );
  } finally {
    await harness.app.close();
  }
});

await test('contradictory raw reply references are refused without sending', async () => {
  const harness = await createTestApplication(Root);
  try {
    await assert.rejects(
      harness.app.client.api.sendPrivateMessage('u', {
        msg_type: 0,
        content: 'x',
        msg_seq: 1,
      } as unknown as QQMessagePayload),
      /reply reference/,
    );
    await assert.rejects(
      harness.app.client.api.sendPrivateMessage('u', {
        msg_type: 0,
        content: 'x',
        msg_id: 'm',
        msg_seq: 1,
        event_id: 'e',
      } as unknown as QQMessagePayload),
      /reply reference/,
    );
    assert.equal(harness.messages.length, 0);
  } finally {
    await harness.app.close();
  }
});

await test('native fetch never follows token or API redirects to another origin', async () => {
  let targetRequests = 0;
  const target = await serve((_request, response) => {
    targetRequests++;
    response.end('{}');
  });
  let redirectToken = true;
  const origin = await serve((request, response) => {
    request.resume();
    if (!redirectToken && request.url === '/app/getAppAccessToken') {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ access_token: 'fixture-token', expires_in: 7200 }));
    } else {
      response.writeHead(307, { location: target.url + '/collect' });
      response.end();
    }
  });
  try {
    for (const tokenRedirect of [true, false]) {
      redirectToken = tokenRedirect;
      const app = await Application.create(Root, {
        appId: 'fixture-app',
        secret: 'fixture-secret',
        api: { baseUrl: origin.url, tokenEndpoint: origin.url + '/app/getAppAccessToken' },
        logger: { debug() {}, info() {}, warn() {}, error() {} },
      });
      try {
        await assert.rejects(app.client.getSelf());
      } finally {
        await app.close();
      }
    }
    assert.equal(targetRequests, 0);
  } finally {
    await origin.close();
    await target.close();
  }
});
