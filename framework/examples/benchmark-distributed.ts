import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { comparisonProfile, elapsedMs, now, record } from './mixed-benchmark/common.js';
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
const options: ComparisonOptions = {
  kind: values.smoke ? 'smoke' : 'comparison',
  concurrency: Number(values.concurrency ?? (values.smoke ? 2 : 32)),
  outboundConcurrency: Number(values['outbound-concurrency']),
  rate: Number(values.rate),
  durationMs: Number(values['duration-ms']),
  diagnostics: values.diagnostics,
};
const config = comparisonProfile(options);
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
  schema: 1,
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
      : 'local generator; remote SDK and loopback HTTP fixtures; SSH input and control channels',
    latency:
      'driver scheduled arrival to observed completion, including tunnel and control return time; same local monotonic clock',
    serverLatency:
      'admission to completion on server clock; excludes generator and ingress waiting',
    phaseAlignment:
      'initial clock-offset estimate for wall-time phase bins only; never used to subtract cross-host latency timestamps',
    network:
      'loopback listeners and authenticated SSH forwarding; no QQ, real SQL, Nginx or rendering workload',
    resourceBudget: values.local
      ? 'no server quota for local self-test'
      : 'SDK, fixture and supervisor share 1.5 CPU cores and 1 GiB; sshd CPU is outside this cgroup',
  },
};
let driver: Worker | undefined;
let remote: RemoteSession | undefined;
let progress: NodeJS.Timeout | undefined;
let nonce = 0;
const entry = fileURLToPath(new URL('./mixed-benchmark/remote-host.js', import.meta.url));
const interrupt = () => {
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
  await driver.wait('driver-ready');
  remote = await RemoteSession.create({
    ...(values.host ? { host: values.host } : {}),
    directory: values.directory ?? process.cwd(),
    node: values.node,
    entry,
    label: values.label,
    token,
    runtimeSeconds: Math.ceil(duration / 1000) + 120,
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
  const ingress = await activeRemote.forward(String(sdkReady.origin));
  activeDriver.send({ type: 'configure', origin: ingress });
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
    (sum, phase) => sum + Number(object(phase.counts).primaryAcknowledged ?? 0),
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
      accepted = Number(counts.primaryAcknowledged ?? 0);
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
      accepted,
      completed: Object.values(outcomes).reduce<number>((sum, count) => sum + Number(count), 0),
      outcomes,
      primaryDrops: counts['driverDropped:primary'] ?? 0,
      allAttemptDrops: counts.driverDropped ?? 0,
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
} finally {
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
