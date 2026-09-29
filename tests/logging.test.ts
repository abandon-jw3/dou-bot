import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorReporter } from '../src/core/logging.js';
import { QQApiError } from '../src/core/errors.js';
import { FakeClock } from './fake-clock.js';
import { deferred } from './helpers.js';

await test('errors and nested logger fields are redacted before reaching user hooks', async () => {
  const clock = new FakeClock();
  const records: unknown[] = [];
  const errors: Error[] = [];
  const write = (message: string, fields?: unknown) => {
    records.push({ message, fields });
  };
  const reporter = new ErrorReporter(
    () => ['fixture-secret'],
    (error) => {
      errors.push(error);
    },
    20,
    { debug: write, info: write, warn: write, error: write },
    clock,
  );
  reporter.logger.info('fixture-secret', {
    authorization: 'Bearer something',
    body: { arbitrary: 'hidden' },
    nested: { info: 'fixture-secret', issue: new Error('fixture-secret') },
    'fixture-secret': 'sensitive field name',
  });
  reporter.report(
    new QQApiError('failure fixture-secret', {
      method: 'GET',
      path: '/fixture-secret',
      httpStatus: 403,
      qqCode: 123,
      traceId: 'fixture-secret',
    }),
    { phase: 'send', appId: 'fixture-app' },
  );
  await clock.flush();
  assert.equal(JSON.stringify(records).includes('fixture-secret'), false);
  assert.equal(JSON.stringify(records).includes('Bearer something'), false);
  assert.ok(errors[0] instanceof QQApiError);
  assert.equal(errors[0].httpStatus, 403);
  assert.equal(errors[0].qqCode, 123);
  assert.equal(errors[0].traceId, '[redacted]');
  assert.equal(errors[0].message.includes('fixture-secret'), false);
  reporter.close();
  assert.equal(clock.pending, 0);
});

await test('a stalled error handler is called once and disabled at its deadline without accumulating tasks', async () => {
  const clock = new FakeClock();
  let calls = 0;
  const output: string[] = [];
  const reporter = new ErrorReporter(
    () => [],
    () => {
      calls++;
      return new Promise(() => {});
    },
    20,
    {
      debug() {},
      info() {},
      warn() {},
      error(message) {
        output.push(message);
      },
    },
    clock,
  );
  for (let i = 0; i < 100; i++)
    reporter.report(new Error('fixture'), { phase: 'command', appId: 'fixture-app' });
  await clock.flush();
  assert.equal(calls, 1);
  assert.equal(clock.pending, 1);
  await clock.advance(20);
  reporter.report(new Error('later'), { phase: 'command', appId: 'fixture-app' });
  await clock.flush();
  assert.equal(calls, 1);
  assert.equal(clock.pending, 0);
  assert.equal(output.filter((message) => message.includes('it is disabled')).length, 1);
  reporter.close();
});

await test('closing the error reporter cancels its timer and drops waiting callbacks', async () => {
  const clock = new FakeClock();
  let calls = 0;
  const reporter = new ErrorReporter(
    () => [],
    () => {
      calls++;
      return new Promise(() => {});
    },
    20000,
    { debug() {}, info() {}, warn() {}, error() {} },
    clock,
  );
  reporter.report(new Error('first'), { phase: 'command', appId: 'fixture-app' });
  reporter.report(new Error('queued'), { phase: 'command', appId: 'fixture-app' });
  await clock.flush();
  reporter.close();
  await clock.flush();
  assert.equal(calls, 1);
  assert.equal(clock.pending, 0);
});

await test('throwing user loggers do not escape or leak their exception message', (context) => {
  const output: string[] = [];
  context.mock.method(process.stderr, 'write', (text: string) => {
    output.push(text);
    return true;
  });
  const fail = () => {
    throw new Error('fixture-secret');
  };
  const reporter = new ErrorReporter(() => ['fixture-secret'], undefined, 20, {
    debug: fail,
    info: fail,
    warn: fail,
    error: fail,
  });
  assert.doesNotThrow(() => reporter.logger.info('fixture-secret'));
  assert.doesNotThrow(() =>
    reporter.report(new Error('fixture-secret'), { phase: 'command', appId: 'fixture-app' }),
  );
  assert.equal(output.length, 2);
  assert.equal(output.join('').includes('fixture-secret'), false);
  reporter.close();
});

await test('uninspectable thrown values remain reportable and error names or string codes cannot leak credentials', async () => {
  const clock = new FakeClock();
  const errors: Error[] = [];
  const reporter = new ErrorReporter(
    () => ['fixture-secret'],
    (error) => {
      errors.push(error);
    },
    20,
    { debug() {}, info() {}, warn() {}, error() {} },
    clock,
  );
  const context = { phase: 'command' as const, appId: 'fixture-app' };
  const broken = new Error();
  Object.defineProperty(broken, 'message', {
    get() {
      throw new Error('getter');
    },
  });
  assert.doesNotThrow(() => reporter.report(broken, context));
  assert.doesNotThrow(() =>
    reporter.report(
      {
        toString() {
          throw new Error('conversion');
        },
      },
      context,
    ),
  );
  const named = new Error('failure');
  named.name = 'fixture-secret';
  reporter.report(named, context);
  reporter.report(
    new QQApiError('failure', { method: 'GET', path: '/fixture', qqCode: 'fixture-secret' }),
    context,
  );
  await clock.flush();
  assert.equal(errors.length, 4);
  assert.match(errors[0]?.message ?? '', /could not be inspected/);
  assert.match(errors[1]?.message ?? '', /could not be inspected/);
  assert.equal(errors[2]?.name, '[redacted]');
  assert.ok(errors[3] instanceof QQApiError);
  assert.equal(errors[3].qqCode, '[redacted]');
  reporter.close();
  assert.equal(clock.pending, 0);
});

await test('logger records framework and QQ error codes with the platform trace identifier', () => {
  const fields: Readonly<Record<string, unknown>>[] = [];
  const reporter = new ErrorReporter(() => [], undefined, 1000, {
    debug() {},
    info() {},
    warn() {},
    error(_message, data) {
      if (data) fields.push(data);
    },
  });
  reporter.report(
    new QQApiError('platform rejected', {
      method: 'POST',
      path: '/fixture',
      qqCode: 11253,
      httpStatus: 403,
      traceId: 'trace-fixture',
    }),
    { phase: 'send', appId: 'fixture-app', controller: 'Commands', method: 'hello' },
  );
  assert.equal(fields[0]?.errorCode, 'QQ_API');
  assert.equal(fields[0]?.qqCode, 11253);
  assert.equal(fields[0]?.traceId, 'trace-fixture');
  assert.equal(fields[0]?.controller, 'Commands');
  assert.equal(fields[0]?.method, 'hello');
  reporter.close();
});

await test('an overflowing error queue keeps 32 waiting callbacks and coalesces dropped reports', async () => {
  const clock = new FakeClock();
  const release = deferred<void>();
  let calls = 0;
  let loggedErrors = 0;
  const drops: unknown[] = [];
  const reporter = new ErrorReporter(
    () => [],
    async () => {
      calls++;
      await release.promise;
    },
    1000,
    {
      debug() {},
      info() {},
      error() {
        loggedErrors++;
      },
      warn(_message, fields) {
        drops.push(fields?.dropped);
      },
    },
    clock,
  );
  for (let index = 0; index < 100; index++)
    reporter.report(new Error('fixture'), { phase: 'command', appId: 'fixture-app' });
  await clock.flush();
  assert.equal(calls, 1);
  assert.equal(loggedErrors, 33);
  release.resolve();
  await clock.flush();
  assert.equal(calls, 33);
  assert.deepEqual(drops, [67]);
  assert.equal(clock.pending, 0);
  reporter.close();
});
