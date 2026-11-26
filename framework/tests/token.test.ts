import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOptions } from '../src/core/config.js';
import { ErrorReporter } from '../src/core/logging.js';
import { FrameworkError, QQApiError } from '../src/core/errors.js';
import { HttpRuntime } from '../src/qq/http.js';
import { TokenManager } from '../src/qq/token.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

const silent = { debug() {}, info() {}, warn() {}, error() {} };
function fixture(respond: (request: number) => Response | Promise<Response>) {
  const clock = new FakeClock();
  const options = resolveOptions({ appId: 'fixture-app', secret: 'fixture-secret' });
  let requests = 0;
  const errors: Error[] = [];
  const reporter = new ErrorReporter(
    () => ['fixture-secret'],
    (error) => {
      errors.push(error);
    },
    1000,
    silent,
    clock,
  );
  const http = new HttpRuntime(options, () => Promise.resolve(respond(++requests)), clock);
  const tokens = new TokenManager(options, http, reporter, clock);
  return {
    clock,
    tokens,
    errors,
    get requests() {
      return requests;
    },
    close() {
      tokens.close();
      http.close();
      reporter.close();
    },
  };
}
const token = (value: string, seconds: unknown = '7200') =>
  Response.json({ access_token: value, expires_in: seconds });

await test('shared token cache refreshes 40 seconds early and ignores wall clock changes', async () => {
  const f = fixture((request) => token(`token-${request}`));
  try {
    assert.deepEqual(
      await Promise.all(Array.from({ length: 20 }, () => f.tokens.getToken())),
      Array<string>(20).fill('token-1'),
    );
    assert.equal(f.requests, 1);
    assert.equal(f.clock.pending, 1);
    f.clock.jumpWall(86_400_000);
    assert.equal(await f.tokens.getToken(), 'token-1');
    await f.clock.advance(7_159_999);
    assert.equal(f.requests, 1);
    f.clock.jumpWall(-172_800_000);
    await f.clock.advance(1);
    assert.equal(f.requests, 2);
    assert.equal(await f.tokens.getToken(), 'token-2');
    assert.equal(f.clock.pending, 1);
  } finally {
    f.close();
  }
  await f.clock.advance(86_400_000);
  assert.equal(f.requests, 2);
  assert.equal(f.clock.pending, 0);
});

await test('failed background refresh keeps an unexpired token, backs off, and refuses expired credentials', async () => {
  let healthy = false;
  const f = fixture((request) =>
    request === 1 || healthy
      ? token(`token-${request}`, 45)
      : Response.json({ code: 40001, message: 'fixture rejected' }),
  );
  try {
    assert.equal(await f.tokens.getToken(), 'token-1');
    await f.clock.advance(5000);
    assert.equal(f.requests, 2);
    assert.equal(await f.tokens.getToken(), 'token-1');
    for (const delay of [1000, 2000, 4000, 8000, 16000]) {
      const before: number = f.requests;
      await f.clock.advance(delay - 1);
      assert.equal(f.requests, before);
      await f.clock.advance(1);
      assert.equal(f.requests, before + 1);
    }
    assert.equal(f.clock.monotonic(), 36000);
    await f.clock.advance(8999);
    assert.equal(await f.tokens.getToken(), 'token-1');
    await f.clock.advance(1);
    await assert.rejects(
      f.tokens.getToken(),
      (error: unknown) => error instanceof QQApiError && error.qqCode === 40001,
    );
    const failedRequests = f.requests;
    await f.clock.advance(29999);
    assert.equal(f.requests, failedRequests);
    healthy = true;
    await f.clock.advance(1);
    assert.equal(f.requests, failedRequests + 1);
    assert.equal(await f.tokens.getToken(), `token-${f.requests}`);
    await f.clock.advance(5000);
    assert.equal(f.requests, failedRequests + 2);
    assert.ok(f.errors.length >= 1);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('invalid lifetimes cannot become credentials through numeric coercion', async () => {
  for (const lifetime of [
    true,
    false,
    [],
    [7200],
    {},
    '',
    ' ',
    'Infinity',
    '1x',
    null,
    0,
    -1,
    1e30,
    0.0001,
  ]) {
    const f = fixture(() => token('invalid-token', lifetime));
    try {
      await assert.rejects(
        f.tokens.getToken(),
        (error: unknown) => error instanceof FrameworkError && error.code === 'PROTOCOL',
      );
      assert.equal(f.tokens.sensitive().includes('invalid-token'), false);
    } finally {
      f.close();
    }
    assert.equal(f.clock.pending, 0);
  }
});

await test('a token already expired by response time cannot replace a still valid credential', async () => {
  const response = deferred<Response>();
  const f = fixture((request) => (request === 1 ? token('old-token', 100) : response.promise));
  try {
    await f.tokens.getToken();
    const refreshed = assert.rejects(f.tokens.refresh(), /expired while being fetched/);
    await f.clock.advance(2000);
    response.resolve(token('late-token', 1));
    await refreshed;
    assert.equal(await f.tokens.getToken(), 'old-token');
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('invalidation aborts a pending refresh and ignores its late response', async () => {
  const response = deferred<Response>();
  const f = fixture((request) => (request === 1 ? response.promise : token('new-token')));
  try {
    const aborted = assert.rejects(f.tokens.getToken(), /invalidated/);
    f.tokens.invalidate();
    await aborted;
    assert.equal(await f.tokens.getToken(), 'new-token');
    response.resolve(token('stale-token'));
    await f.clock.flush();
    assert.equal(await f.tokens.getToken(), 'new-token');
    assert.equal(f.requests, 2);
    assert.equal(f.clock.pending, 1);
  } finally {
    f.close();
  }
  assert.equal(f.clock.pending, 0);
});

await test('closing during refresh prevents late credentials and all future refresh timers', async () => {
  const response = deferred<Response>();
  const f = fixture(() => response.promise);
  const aborted = assert.rejects(f.tokens.getToken(), /invalidated|closed/);
  f.close();
  await aborted;
  response.resolve(token('late-token'));
  await f.clock.advance(86_400_000);
  await assert.rejects(f.tokens.getToken(), /closed/);
  assert.equal(f.requests, 1);
  assert.equal(f.clock.pending, 0);
});
