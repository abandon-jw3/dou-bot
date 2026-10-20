import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { accountIds, comparisonProfile, elapsedMs, now, record } from './mixed-benchmark/common.js';
import type { ComparisonOptions } from './mixed-benchmark/common.js';
import { fingerprint } from './mixed-benchmark/fingerprint.js';
import { RemoteSession } from './mixed-benchmark/remote-session.js';
import { Worker } from './mixed-benchmark/worker.js';
import type { Message } from './mixed-benchmark/worker.js';

const { values } = parseArgs({
  options: {
    local: { type: 'boolean' },
    host: { type: 'string' },
    directory: { type: 'string' },
    node: { type: 'string', default: 'node' },
    label: { type: 'string', default: `comparison-${Date.now()}` },
    smoke: { type: 'boolean' },
    concurrency: { type: 'string' },
    'outbound-concurrency': { type: 'string', default: '8' },
    rate: { type: 'string', default: '500' },
    'duration-ms': { type: 'string', default: '120000' },
    diagnostics: { type: 'string', default: 'off' },
    transport: { type: 'string', default: 'webhook' },
    bots: { type: 'string', default: '1' },
    'first-bot-percent': { type: 'string', default: '50' },
    isolation: { type: 'boolean' },
    database: { type: 'string', default: 'memory' },
    'database-pool': { type: 'string' },
    'database-file': { type: 'string' },
  },
});
assert.equal(Boolean(values.local), !values.host, 'Choose --local or --host');
assert.match(values.label, /^[a-z0-9-]{1,40}$/u);
if (values.host) assert.ok(values.directory, 'Remote SDK directory is required');
assert.ok(
  values.diagnostics === 'off' ||
    values.diagnostics === 'metrics' ||
    values.diagnostics === 'sampled',
);
assert.ok(values.transport === 'webhook' || values.transport === 'ws');
assert.ok(values.bots === '1' || values.bots === '2');
assert.ok(values.database === 'memory' || values.database === 'postgres');
assert.equal(
  Boolean(values['database-file']),
  values.database === 'postgres',
  'PostgreSQL requires an explicit disposable database file',
);
const options: ComparisonOptions = {
  database: values.database,
  ...(values['database-pool'] === undefined
    ? {}
    : { databasePool: Number(values['database-pool']) }),
  transport: values.transport,
  bots: values.bots === '2' ? 2 : 1,
  firstBotPercent: Number(values['first-bot-percent']),
  kind: values.smoke ? 'smoke' : 'comparison',
  concurrency: Number(values.concurrency ?? (values.smoke ? 2 : 32)),
  outboundConcurrency: Number(values['outbound-concurrency']),
  rate: Number(values.rate),
  durationMs: Number(values['duration-ms']),
  diagnostics: values.diagnostics,
};
const config = comparisonProfile(options);
if (values.isolation)
  assert.ok(
    config.transport === 'ws' && config.bots === 2 && !values.smoke && options.durationMs >= 20000,
  );
const token = Buffer.from(JSON.stringify(options)).toString('base64url');
const duration = config.phases.reduce((sum, phase) => sum + phase.durationMs, 0);
const output = resolve('work/distributed', values.label);
await mkdir(resolve('work/distributed'), { recursive: true });
await mkdir(output);
const object = (value: unknown): Message => {
  assert.ok(record(value));
  return value;
};
const rows = (value: unknown): Message[] => {
  assert.ok(Array.isArray(value));
  return value.map(object);
};
const report: Message = {
  schema: 2,
  startedAt: new Date().toISOString(),
  configuration: config,
  generator: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
  },
  source: await fingerprint(),
  measurement: {
    topology: values.local
      ? 'local framed-protocol self-test, separate processes'
      : 'local generator and WS gateway; remote SDK and loopback HTTP fixtures; SSH input and control channels',
    wsDelivery: 'no replay on RESUME; socket write is not SDK receipt or admission',
    capacityEligible: !values.isolation,
    isolation: values.isolation
      ? 'first bot gateway reconnect at 20%, stop at 45%, start at 65% of measurement; second bot receives continuous load'
      : undefined,
    latency:
      'driver scheduled arrival to observed completion, including tunnel and control return time; same local monotonic clock',
    serverLatency:
      'admission to completion on server clock; excludes generator and ingress waiting',
    phaseAlignment:
      'initial clock-offset estimate for wall-time phase bins only; never used to subtract cross-host latency timestamps',
    network: `loopback listeners and authenticated SSH forwarding; ${config.database === 'postgres' ? 'real disposable PostgreSQL' : 'memory persistence'}; no QQ, Nginx or rendering workload`,
    resourceBudget: values.local
      ? 'no server quota for local self-test'
      : 'SDK, fixture and supervisor share 1.5 CPU cores and 1 GiB; sshd and PostgreSQL are outside this cgroup and require separate accounting',
  },
};
let driver: Worker | undefined;
let remote: RemoteSession | undefined;
let progress: NodeJS.Timeout | undefined;
let nonce = 0;
const lifetime = new AbortController();
const entry = fileURLToPath(new URL('./mixed-benchmark/remote-host.js', import.meta.url));
const interrupt = () => {
  lifetime.abort();
  if (driver)
    void driver.stop().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  if (remote)
    void remote.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
};
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  driver = new Worker(['--driver', token, resolve(output, 'driver.json')], entry);
  const driverReady = await driver.wait('driver-ready');
  remote = await RemoteSession.create({
    ...(values['database-file'] ? { databaseFile: values['database-file'] } : {}),
    ...(values.host ? { host: values.host } : {}),
    directory: values.directory ?? process.cwd(),
    node: values.node,
    entry,
    label: values.label,
    token,
    runtimeSeconds: Math.ceil(duration / 1000) + 120,
    ...(config.transport === 'ws' ? { gatewayOrigin: String(driverReady.gatewayOrigin) } : {}),
  });
  const activeDriver = driver,
    activeRemote = remote;
  activeRemote.sdk.onMessage = (message) => {
    if (['root-done', 'completion'].includes(String(message.type))) {
      activeDriver.send(message);
      return true;
    }
    return false;
  };
  activeRemote.fixture.onMessage = (message) => {
    if (message.type === 'question') {
      activeDriver.send(message);
      return true;
    }
    return false;
  };
  activeDriver.onMessage = (message) => {
    if (message.type === 'phase') {
      console.log(`distributed benchmark: ${String(message.name)}`);
      return true;
    }
    return false;
  };
  const ready = await activeRemote.control.wait('host-ready', 40000);
  const sdkReady = object(ready.sdk);
  assert.equal(sdkReady.concurrency, config.concurrency);
  assert.equal(sdkReady.outboundConcurrency, config.outboundConcurrency);
  assert.equal(
    object(ready.source).sdkSha256,
    object(report.source).sdkSha256,
    'Server SDK source differs',
  );
  assert.equal(
    object(ready.source).harnessSha256,
    object(report.source).harnessSha256,
    'Server harness source differs',
  );
  report.server = ready;
  report.unit = activeRemote.unit;
  if (config.transport !== 'ws') {
    const ingress = await activeRemote.forward(String(sdkReady.origin));
    activeDriver.send({ type: 'configure', origin: ingress });
  }
  const clock = async () => {
    const id = String(++nonce),
      before = now();
    activeRemote.send('sdk', { type: 'clock', nonce: id });
    const reply = await activeRemote.sdk.wait('clock', 5000, id);
    const after = now();
    assert.equal(typeof reply.atNs, 'string');
    const offset = BigInt(reply.atNs as string) - (before + after) / 2n;
    return {
      beforeNs: before.toString(),
      afterNs: after.toString(),
      serverNs: reply.atNs,
      offsetNs: offset.toString(),
      roundTripMs: Number(after - before) / 1e6,
    };
  };
  const alignment = [];
  for (let i = 0; i < 5; i++) alignment.push(await clock());
  const best = [...alignment].sort((a, b) => a.roundTripMs - b.roundTripMs)[0]!;
  report.clockAlignment = { initial: alignment, initialUncertaintyMs: best.roundTripMs / 2 };
  const start = now() + 1_000_000_000n;
  const serverStart = start + BigInt(best.offsetNs);
  activeRemote.send('fixture', { type: 'begin', startNs: serverStart.toString() });
  activeRemote.send('sdk', { type: 'begin', startNs: serverStart.toString() });
  activeDriver.send({ type: 'begin', startNs: start.toString() });
  report.startNs = start.toString();
  report.serverStartNs = serverStart.toString();
  let isolationError: unknown;
  const isolation = (async () => {
    if (!values.isolation) return;
    const actions: Message[] = [];
    report.isolationActions = actions;
    const appId = accountIds(config)[0]!;
    for (const [fraction, action] of [
      [0.2, 'reconnect'],
      [0.45, 'stop'],
      [0.65, 'start'],
    ] as const) {
      const dueMs = config.phases[0]!.durationMs + options.durationMs * fraction;
      await sleep(Math.max(0, dueMs - elapsedMs(start)), undefined, { signal: lifetime.signal });
      const id = String(++nonce);
      if (action === 'reconnect') {
        activeDriver.send({ type: 'gateway-reconnect', appId, nonce: id });
        actions.push({ action, ...(await activeDriver.wait('gateway-reconnected', 5000, id)) });
      } else {
        activeRemote.send('sdk', { type: 'bot-control', action, appId, nonce: id });
        const result = await activeRemote.sdk.wait('bot-controlled', 15000, id);
        assert.equal(result.error, undefined, String(result.error));
        actions.push(result);
      }
    }
  })().catch((error: unknown) => {
    isolationError = error;
  });
  const snapshot = async () => {
    let id = String(++nonce);
    activeRemote.send('fixture', { type: 'snapshot', nonce: id });
    const fixture = object((await activeRemote.fixture.wait('fixture-snapshot', 10000, id)).data);
    id = String(++nonce);
    activeRemote.send('sdk', { type: 'snapshot', nonce: id });
    const sdk = object((await activeRemote.sdk.wait('sdk-snapshot', 10000, id)).data);
    id = String(++nonce);
    activeDriver.send({ type: 'snapshot', nonce: id });
    const driver = await activeDriver.wait('driver-snapshot', 10000, id);
    return { sdk, fixture, driver };
  };
  let sampling = false;
  const progressErrors: string[] = [];
  progress = setInterval(() => {
    if (sampling) return;
    sampling = true;
    void snapshot()
      .then(({ sdk, driver }) => {
        console.log(
          JSON.stringify({
            elapsedSeconds: Math.round(elapsedMs(start) / 1000),
            resources: sdk.resources,
            outbound: sdk.outbound,
            outstanding: driver.outstanding,
            completedPrimary: driver.completedPrimary,
          }),
        );
      })
      .catch((error: unknown) => {
        if (progressErrors.length < 10) progressErrors.push(String(error));
      })
      .finally(() => {
        sampling = false;
      });
  }, 15000);
  console.log(
    `distributed benchmark: ${values.label}, ${duration / 1000} s, concurrency ${config.concurrency}/${config.outboundConcurrency}`,
  );
  await activeDriver.wait('load-finished', duration + 30000);
  await isolation;
  if (isolationError) throw new Error('Isolation control failed', { cause: isolationError });
  clearInterval(progress);
  while (sampling) await sleep(20);
  const drainStarted = now();
  for (;;) {
    const state = await snapshot();
    const resources = object(state.sdk.resources);
    if (
      resources.active === 0 &&
      resources.pending === 0 &&
      resources.prompts === 0 &&
      state.driver.outstanding === 0 &&
      state.driver.timers === 0 &&
      state.driver.gatewayDrained === true &&
      state.fixture.fixtureActive === 0
    ) {
      report.afterLoad = state;
      break;
    }
    assert.ok(elapsedMs(drainStarted) < 60000, 'Distributed workload did not drain');
    await sleep(100);
  }
  report.drainMs = elapsedMs(drainStarted);
  object(report.clockAlignment).afterLoad = await clock();
  activeRemote.send('sdk', { type: 'close' });
  report.sdk = await activeRemote.report(
    'sdk',
    await activeRemote.sdk.wait('sdk-final'),
    resolve(output, 'sdk.json'),
  );
  activeRemote.send('fixture', { type: 'close' });
  report.fixture = await activeRemote.report(
    'fixture',
    await activeRemote.fixture.wait('fixture-final'),
    resolve(output, 'fixture.json'),
  );
  report.hostFinal = await activeRemote.control.wait('host-final');
  await activeRemote.exited;
  assert.equal(activeRemote.exitCode, 0);
  activeDriver.send({ type: 'finish' });
  const notice = await activeDriver.wait('driver-final');
  assert.equal(notice.reportPath, resolve(output, 'driver.json'));
  report.driver = JSON.parse(await readFile(resolve(output, 'driver.json'), 'utf8')) as unknown;
  await activeDriver.exited;
  assert.equal(activeDriver.child.exitCode, 0);

  const sdk = object(report.sdk),
    fixture = object(report.fixture),
    driverReport = object(report.driver);
  const sdkPhases = rows(sdk.phases),
    driverPhases = rows(driverReport.phases);
  const problems: string[] = [];
  if (config.database === 'postgres') {
    const database = object(sdk.database);
    if (database.kind !== 'postgres' || database.schemaDropped !== true)
      problems.push('PostgreSQL backend or schema cleanup was not verified');
    const sql = rows(database.phases);
    if (sql.length !== sdkPhases.length) problems.push('SQL phase accounting differs');
    for (const [index, phase] of sql.entries()) {
      if (
        phase.attempts !== sdkPhases[index]?.loads ||
        Number(phase.completed) + Number(phase.failed) + Number(phase.cancelled) !==
          phase.attempts ||
        object(phase.latencyIncludingPoolWait).count !== phase.attempts
      )
        problems.push(`SQL lookup accounting differs in phase ${index}`);
    }
    const finalPool = object(object(sdk.snapshot).database);
    if (Object.values(finalPool).some((count) => count !== 0))
      problems.push('SQL connections or waiters retained after close');
  }
  for (const [name, count] of Object.entries({
    'SDK errors': Number(object(sdk.globalCounts).unexpected ?? 0),
    'fixture errors': Number(object(fixture.counts).unexpected ?? 0),
    'driver errors': Number(object(driverReport.counts).unexpected ?? 0),
  }))
    if (count !== 0) problems.push(`${name}: ${count}`);
  const dropped = driverPhases.reduce(
    (sum, phase) => sum + Number(object(phase.counts).driverDropped ?? 0),
    0,
  );
  if (dropped) problems.push(`Generator dropped ${dropped} attempts`);
  const accepted = driverPhases.reduce(
    (sum, phase, index) =>
      sum +
      Number(
        config.transport === 'ws'
          ? (object(sdkPhases[index]!.primaryAdmissions).accepted ?? 0)
          : (object(phase.counts).primaryAcknowledged ?? 0),
      ),
    0,
  );
  if (accepted !== driverReport.completedPrimary)
    problems.push(
      `Accepted ${accepted}, observed ${String(driverReport.completedPrimary)} primary completions`,
    );
  const issued = new Set(driverReport.issuedIds as number[]);
  assert.ok(Array.isArray(fixture.references));
  if (fixture.references.some((id) => !issued.has(Number(id))))
    problems.push('Fixture received a reference that was never offered');
  if (Object.values(object(sdk.final)).some((value) => value !== 0))
    problems.push('SDK resources were not released');
  if (Object.values(object(fixture.cleanup)).some((value) => value !== 0))
    problems.push('Fixture resources were not released');
  if (Object.values(object(driverReport.cleanup)).some((value) => value !== 0))
    problems.push('Driver resources were not released');
  if (progressErrors.length) problems.push(...progressErrors);
  if (record(driverReport.gateway) && driverReport.gateway.errorCount !== 0)
    problems.push(`Gateway errors: ${String(driverReport.gateway.errorCount)}`);
  const diagnostics = object(sdk.diagnostics);
  const diagnosticSnapshot = object(diagnostics.snapshot);
  for (const key of ['droppedMeasurements', 'droppedSpans', 'exportFailures'])
    if (Number(diagnosticSnapshot[key]) !== 0)
      problems.push(`Diagnostics ${key}: ${String(diagnosticSnapshot[key])}`);
  if (Number(object(diagnostics.timeline).droppedSamples) !== 0)
    problems.push('Diagnostics timeline lost snapshots');
  if (values.isolation) {
    const [first, second] = accountIds(config);
    const gateway = object(driverReport.gateway);
    const connections = object(gateway.accounts);
    const firstAccount = object(connections[first!]);
    const secondAccount = object(connections[second!]);
    const secondPhases = rows(object(driverReport.byBot)[second!]);
    const lostSecond = secondPhases.some(
      (phase) =>
        Number(object(phase.counts).primary ?? 0) !==
        Object.values(object(phase.outcomes)).reduce<number>((n, value) => n + Number(value), 0),
    );
    const secondOutcomes = secondPhases.flatMap((phase) => Object.entries(object(phase.outcomes)));
    const secondFailure = secondOutcomes.some(
      ([outcome, count]) =>
        Number(count) > 0 &&
        !['success', 'guard-denied', 'invalid-input', 'intentional-business-error'].includes(
          outcome,
        ),
    );
    const passed =
      !lostSecond &&
      !secondFailure &&
      Number(firstAccount.resumes) >= 1 &&
      Number(firstAccount.identifies) === 2 &&
      Number(secondAccount.connections) === 1 &&
      rows(sdk.controls).at(-1)?.status === 'running';
    report.isolation = { passed, lostSecond, secondFailure, firstAccount, secondAccount };
    if (!passed) problems.push('Dual-bot isolation verification failed');
  }
  report.integrityProblems = problems;
  report.integrity = problems.length ? 'failed' : 'passed';
  report.results = config.phases.map((phase, index) => {
    const client = driverPhases[index]!;
    const counts = object(client.counts),
      outcomes = object(client.outcomes);
    const samples = rows(sdk.samples).filter((sample) => sample.phase === index);
    const tail = samples.slice(-Math.min(30, samples.length));
    const peak = (values: number[]) => Math.max(0, ...values);
    const scheduled = Number(counts.primary ?? 0),
      accepted = Number(
        config.transport === 'ws'
          ? (object(sdkPhases[index]!.primaryAdmissions).accepted ?? 0)
          : (counts.primaryAcknowledged ?? 0),
      );
    const received = Number(sdkPhases[index]!.receivedPrimary);
    const nonExpected = Object.entries(outcomes)
      .filter(
        ([key]) =>
          !['success', 'guard-denied', 'invalid-input', 'intentional-business-error'].includes(key),
      )
      .reduce((sum, [, count]) => sum + Number(count), 0);
    const tailQueues = tail
      .map((sample) => Number(object(sample.resources).pending))
      .sort((a, b) => a - b);
    const tailQueueMedian = tailQueues[Math.floor(tailQueues.length / 2)] ?? 0;
    return {
      name: phase.name,
      rate: phase.rate,
      durationMs: phase.durationMs,
      scheduled,
      received,
      notReceived: scheduled - received,
      accepted,
      completed: Object.values(outcomes).reduce<number>((sum, count) => sum + Number(count), 0),
      outcomes,
      primaryDrops: counts['driverDropped:primary'] ?? 0,
      allAttemptDrops: counts.driverDropped ?? 0,
      written: config.transport === 'ws' ? (counts.primaryWritten ?? 0) : undefined,
      wsUnavailableAttempts: counts.wsUnavailable ?? 0,
      wsWriteErrors: counts.wsWriteErrors ?? 0,
      admissionAttempts: sdkPhases[index]!.primaryAdmissions,
      schedulingLag: client.schedulingLag,
      byBot: Object.fromEntries(
        Object.entries(object(driverReport.byBot)).map(([id, phases]) => {
          const driver = rows(phases)[index]!;
          const server = rows(object(sdk.byBot)[id])[index]!;
          return [
            id,
            {
              scheduled: object(driver.counts).primary ?? 0,
              received: server.receivedPrimary,
              accepted: object(server.primaryAdmissions).accepted ?? 0,
              completed: Object.values(object(driver.outcomes)).reduce<number>(
                (n, value) => n + Number(value),
                0,
              ),
              outcomes: driver.outcomes,
              successLatency: driver.successLatency,
            },
          ];
        }),
      ),
      successLatency: client.successLatency,
      terminalLatency: client.terminalLatency,
      serverAdmissionLatency: sdkPhases[index]!.successLatency,
      successPerSecondByCompletionTime:
        Number(client.successfulCompletionsByWallTime) / (phase.durationMs / 1000),
      inboundQueuePeak: peak(samples.map((sample) => Number(object(sample.resources).pending))),
      outboundQueuePeak: peak(samples.map((sample) => Number(object(sample.outbound).pending))),
      tailQueueMedian,
      sdkRssPeakMiB: peak(samples.map((sample) => Number(object(sample.memory).rss) / 1048576)),
      capacityPassed:
        !values.isolation &&
        problems.length === 0 &&
        accepted === scheduled &&
        nonExpected === 0 &&
        tailQueueMedian === 0,
    };
  });
  if (problems.length) process.exitCode = 1;
} catch (error) {
  report.integrity = 'failed';
  report.failure =
    error instanceof Error ? { message: error.message, stack: error.stack } : String(error);
  process.exitCode = 1;
  // Preserve the original failure even if a broken remote channel also blocks cleanup.
  await writeFile(resolve(output, 'failure.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
} finally {
  lifetime.abort();
  if (progress) clearInterval(progress);
  const cleanup = await Promise.allSettled([driver?.stop(), remote?.close()]);
  const cleanupErrors = cleanup.flatMap((result) =>
    result.status === 'rejected' ? [String(result.reason)] : [],
  );
  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.integrity = 'failed';
    process.exitCode = 1;
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  report.finishedAt = new Date().toISOString();
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      path: resolve(output, 'report.json'),
      integrity: report.integrity,
      problems: report.integrityProblems,
      failure: report.failure,
    }),
  );
}
