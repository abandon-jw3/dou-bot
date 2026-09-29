import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as tick, setTimeout as delay } from 'node:timers/promises';
import { createTestApplication } from 'dd-bot/testing';
import { createModule } from '../src/app.js';
import { WeatherService } from '../src/weather/service.js';
import { WeatherError, WeatherHttp } from '../src/weather/http.js';
import { fixtureFetch, forecast, requestUrl, testConfig } from './fixtures.js';

await test('service constructs real provider requests, validates responses and caches each city/unit independently', async (t) => {
  const calls: URL[] = [];
  let now = 0;
  const h = await createTestApplication(
    createModule(testConfig, { fetch: fixtureFetch(calls), now: () => now }),
  );
  t.after(() => h.app.close());
  const service = h.app.get(WeatherService);
  const signal = new AbortController().signal;
  const first = await service.get('北京市', 'c', signal);
  assert.equal(first.cached, false);
  assert.equal(first.report.city, '北京');
  assert.equal(first.report.temperature, 22);
  assert.equal(calls[0]!.searchParams.get('name'), 'Beijing');
  assert.equal(calls[0]!.searchParams.get('countryCode'), 'CN');
  assert.equal(calls[1]!.searchParams.get('latitude'), '39.9075');
  assert.equal(calls[1]!.searchParams.get('timezone'), 'Asia/Shanghai');
  assert.equal(calls[1]!.searchParams.get('forecast_days'), '3');
  assert.equal((await service.get('北京', 'c', signal)).cached, true);
  assert.equal(calls.length, 2);
  now = 60000;
  assert.equal((await service.get('北京', 'c', signal)).cached, false);
  assert.equal(calls.length, 3);
  assert.equal((await service.get('北京', 'f', signal)).report.unit, '°F');
  assert.equal(calls.length, 4);
  assert.equal((await service.get('北京', 'c', signal, true)).cached, false);
  assert.equal(calls.length, 5);
  assert.equal(Object.isFrozen(first.report.days), true);
});

await test('unknown cities and invalid provider values are rejected rather than replaced by demonstration data', async (t) => {
  const bodies: unknown[] = [
    {},
    { ...forecast(), current: { ...forecast().current, temperature_2m: '22' } },
    { ...forecast(), current: { ...forecast().current, relative_humidity_2m: null } },
    { ...forecast(), daily: { ...forecast().daily, time: [] } },
    { ...forecast(), current_units: { temperature_2m: '°F', wind_speed_10m: 'm/s' } },
    { ...forecast(), daily: { ...forecast().daily, temperature_2m_min: [99, 17, 19] } },
    { ...forecast(), utc_offset_seconds: 0 },
  ];
  for (const body of bodies) {
    const fetcher: typeof fetch = (input) =>
      requestUrl(input).hostname === 'geocoding-api.open-meteo.com'
        ? fixtureFetch()(input)
        : Promise.resolve(Response.json(body));
    const h = await createTestApplication(createModule(testConfig, { fetch: fetcher }));
    t.after(() => h.app.close());
    const service = h.app.get(WeatherService);
    await assert.rejects(
      service.get('北京', 'c', new AbortController().signal),
      (error: unknown) => error instanceof WeatherError && error.code === 'INVALID_DATA',
    );
  }
  const h = await createTestApplication(
    createModule(testConfig, {
      fetch: () => {
        assert.fail('no request for unknown city');
      },
    }),
  );
  t.after(() => h.app.close());
  await assert.rejects(
    h.app.get(WeatherService).get('not-a-city', 'c', new AbortController().signal),
    /CITY_NOT_FOUND/u,
  );
});

await test('HTTP errors, non-JSON and oversized streams fail safely and timeout covers a stalled body', async () => {
  const signal = new AbortController().signal;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  for (const [response, code] of [
    [Response.json({ error: true }, { status: 429 }), 'HTTP'],
    [new Response('<html>failure</html>'), 'INVALID_DATA'],
    [new Response('x', { headers: { 'content-length': '999999' } }), 'BODY_LIMIT'],
    [new Response('x'.repeat(262145)), 'BODY_LIMIT'],
  ] as const) {
    const http = new WeatherHttp(() => Promise.resolve(response), testConfig);
    await assert.rejects(
      http.json(url, signal),
      (error: unknown) => error instanceof WeatherError && error.code === code,
    );
  }
  let cancelled = false;
  const stalled = new WeatherHttp(
    () =>
      Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
        ),
      ),
    { ...testConfig, requestTimeoutMs: 20 },
  );
  const timed = assert.rejects(
    stalled.json(url, signal),
    (error: unknown) => error instanceof WeatherError && error.code === 'TIMEOUT',
  );
  await Promise.all([timed, delay(40)]);
  assert.equal(cancelled, true);
});

await test('caller cancellation stops waiting even when a fetch port ignores its signal, and no unsafe host is requested', async () => {
  const controller = new AbortController();
  const http = new WeatherHttp(() => new Promise(() => {}), testConfig);
  const request = assert.rejects(
    http.json(new URL('https://api.open-meteo.com/v1/forecast'), controller.signal),
    /caller stopped/u,
  );
  controller.abort(new Error('caller stopped'));
  await request;
  await assert.rejects(
    http.json(new URL('https://example.com/'), new AbortController().signal),
    /INVALID_DATA/u,
  );
});

await test('a late response from an abort-ignoring port is cancelled after the caller leaves', async () => {
  let release!: (response: Response) => void;
  let cancelled = false;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const http = new WeatherHttp(() => pending, testConfig);
  const abort = new AbortController();
  const checked = assert.rejects(
    http.json(new URL('https://api.open-meteo.com/v1/forecast'), abort.signal),
    /stopped/u,
  );
  abort.abort(new Error('stopped'));
  await checked;
  release(
    new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await tick();
  assert.equal(cancelled, true);
});
