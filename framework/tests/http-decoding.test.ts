import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpRuntime } from '../src/qq/http.js';
import { resolveOptions } from '../src/core/config.js';
import { deferred } from './helpers.js';

await test('HTTP decoding preserves views, split UTF-8, BOM and isolation after malformed responses', async () => {
  const encoder = new TextEncoder();
  const pending = deferred<Response>();
  const bodies = [
    Promise.resolve(new Response(encoder.encode('unused天气🌧unused').subarray(6, -6))),
    Promise.resolve(new Response(new Uint8Array([0xe5, 0xa4]))),
    Promise.resolve(new Response(encoder.encode('\uFEFF正确'))),
    Promise.resolve(new Response(null, { status: 204 })),
    pending.promise,
    Promise.resolve(new Response(encoder.encode('另一条消息'))),
  ];
  const http = new HttpRuntime(resolveOptions({ appId: 'fixture', secret: 'fixture' }), () =>
    bodies.shift()!,
  );
  const read = () => http.request('https://fixture.invalid/messages', {});
  try {
    assert.equal((await read()).text, '天气🌧');
    await assert.rejects(read(), TypeError);
    assert.equal((await read()).text, '正确');
    assert.equal((await read()).text, '');
    const delayed = read();
    assert.equal((await read()).text, '另一条消息');
    const bytes = encoder.encode('分块🌧完成');
    pending.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
      ),
    );
    assert.equal((await delayed).text, '分块🌧完成');
    await http.drain(Infinity);
  } finally {
    http.close();
  }
});

await test('HTTP single-chunk path still checks actual bytes despite a smaller Content-Length', async () => {
  let cancelled = false;
  const http = new HttpRuntime(
    resolveOptions({ appId: 'fixture', secret: 'fixture', api: { maxResponseBytes: 16 } }),
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new Uint8Array(17));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-length': '1' } },
        ),
      ),
  );
  try {
    await assert.rejects(http.request('https://fixture.invalid/messages', {}), {
      code: 'RESOURCE_LIMIT',
    });
    assert.equal(cancelled, true);
    await http.drain(Infinity);
  } finally {
    http.close();
  }
});
