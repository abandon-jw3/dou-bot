import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { Module, image } from '../src/index.js';
import type { RequestOptions } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';
import { deferred } from './helpers.js';

@Module({})
class Root {}

await test('API calls retain their original cancellation signal while awaiting a shared token', async () => {
  const token = deferred<Response>();
  const entered = deferred<void>();
  const original = new AbortController();
  const replacement = new AbortController();
  const options: RequestOptions = { signal: original.signal };
  const h = await createTestApplication(Root, {
    respond(request) {
      if (request.url.pathname.endsWith('/app/getAppAccessToken')) return token.promise;
      entered.resolve();
      return new Promise<Response>(() => {});
    },
  });
  let failure: unknown;
  const finished = h.app.client.api.getSelf(options).then(
    () => {},
    (error: unknown) => {
      failure = error;
    },
  );
  try {
    options.signal = replacement.signal;
    token.resolve(Response.json({ access_token: 'fixture-token', expires_in: 7200 }));
    await entered.promise;
    original.abort(new Error('original signal cancelled'));
    await tick();
    assert.ok(failure instanceof Error && failure.message === 'original signal cancelled');
  } finally {
    replacement.abort();
    await finished;
    await h.app.close();
  }
});

await test('image sends retain cancellation across upload and send even if caller reuses its options object', async () => {
  const upload = deferred<Response>();
  const uploading = deferred<void>();
  const sending = deferred<void>();
  const original = new AbortController();
  const replacement = new AbortController();
  const options: RequestOptions = { signal: original.signal };
  const h = await createTestApplication(Root, {
    respond(request) {
      if (request.url.pathname.endsWith('/files')) {
        uploading.resolve();
        return upload.promise;
      }
      if (request.url.pathname.endsWith('/messages')) {
        sending.resolve();
        return new Promise<Response>(() => {});
      }
      return undefined;
    },
  });
  let failure: unknown;
  const finished = h.app.client
    .sendMessage({ scene: 'private', userId: 'user' }, image(new Uint8Array([1, 2, 3])), options)
    .then(
      () => {},
      (error: unknown) => {
        failure = error;
      },
    );
  try {
    await uploading.promise;
    options.signal = replacement.signal;
    upload.resolve(Response.json({ file_info: 'fixture-file', ttl: 60 }));
    await sending.promise;
    original.abort(new Error('original image cancelled'));
    await tick();
    assert.ok(failure instanceof Error && failure.message === 'original image cancelled');
  } finally {
    replacement.abort();
    await finished;
    await h.app.close();
  }
});
