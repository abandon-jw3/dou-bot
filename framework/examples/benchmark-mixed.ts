import assert from 'node:assert/strict';
import { fork, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { elapsedMs, now, profile, record } from './mixed-benchmark/common.js';

const role = process.argv[2];

class Worker {
  readonly child: ChildProcess;
  readonly queued: Record<string, unknown>[] = [];
  readonly waiters = new Set<{
    predicate: (message: Record<string, unknown>) => boolean;
    resolve: (message: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  readonly exited: Promise<void>;
  dead = false;
  onMessage?: (message: Record<string, unknown>) => boolean;
  constructor(args: string[]) {
    this.child = fork(fileURLToPath(import.meta.url), args, {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: ['--expose-gc'],
    });
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        this.dead = true;
        resolve();
      }),
    );
    this.child.on('message', (message: unknown) => {
      if (!record(message) || this.onMessage?.(message)) return;
      for (const waiter of this.waiters)
        if (waiter.predicate(message)) {
          this.waiters.delete(waiter);
          waiter.resolve(message);
          return;
        }
      this.queued.push(message);
    });
    this.child.once('close', (code, signal) => {
      for (const waiter of this.waiters)
        waiter.reject(new Error(`Worker ${args[0]} exited ${code ?? signal}`));
      this.waiters.clear();
    });
  }
  send(message: Record<string, unknown>): void {
    if (this.child.connected) this.child.send(message);
  }
  wait(type: string, timeoutMs = 20000, nonce?: string): Promise<Record<string, unknown>> {
    const predicate = (message: Record<string, unknown>) =>
      message.type === type && (nonce === undefined || message.nonce === nonce);
    const index = this.queued.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queued.splice(index, 1)[0]!);
    if (this.dead) return Promise.reject(new Error(`Worker exited before ${type}`));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      const waiter = {
        predicate,
        resolve: (message: Record<string, unknown>) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
  }
  async stop(): Promise<void> {
    if (this.dead) return;
    if (this.child.connected) this.child.disconnect();
    const force = setTimeout(() => {
      this.child.kill('SIGKILL');
    }, 12000);
    await this.exited;
    clearTimeout(force);
  }
}
function object(value: unknown): Record<string, unknown> {
  assert.ok(record(value));
  return value;
}
async function digest(paths: string[]): Promise<string> {
  const hash = createHash('sha256');
  for (const path of paths.sort()) {
    hash.update(path);
    hash.update(await readFile(path));
  }
  return hash.digest('hex');
}
async function result(worker: Worker, type: string, path: string): Promise<unknown> {
  const notice = await worker.wait(type, 20000);
  assert.equal(notice.reportPath, path);
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}
async function main(): Promise<void> {
  const config = profile(role ?? 'standard');
  const label = process.argv[3] ?? `${config.name}-${Date.now()}`;
  assert.match(label, /^[a-z0-9-]+$/u, 'Label must contain lowercase letters, digits or hyphens');
  const output = resolve('work/mixed-benchmark', `${label}.json`);
  await mkdir(resolve('work/mixed-benchmark'), { recursive: true });
  for (const path of [output, `${output}.sdk.json`, `${output}.driver.json`]) {
    await access(path).then(
      () => {
        throw new Error(`Report already exists: ${path}`);
      },
      (error: unknown) => {
        if (!record(error) || error.code !== 'ENOENT') throw error;
      },
    );
  }

  const sourceFiles = (await readdir('src', { recursive: true }))
    .filter((path) => path.endsWith('.ts'))
    .map((path) => `src/${path}`);
  const harnessFiles = (await readdir('examples/mixed-benchmark'))
    .filter((path) => path.endsWith('.ts'))
    .map((path) => `examples/mixed-benchmark/${path}`)
    .concat('examples/benchmark-mixed.ts', 'examples/soak-support.ts');
  const report: Record<string, unknown> = {
    schema: 1,
    startedAt: new Date().toISOString(),
    configuration: config,
    negativeControl: process.env.DOU_BOT_BENCHMARK_CORRUPT_DATA === '1',
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      gc: 'baseline/end only; no forced GC during load',
    },
    source: {
      gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
      sdkSha256: await digest(sourceFiles),
      harnessSha256: await digest(harnessFiles),
    },
    measurement: {
      ingress: 'loopback HTTP, JSON parsing and Ed25519 verification',
      business: 'real-clock local HTTP fixtures; no real QQ, database, TLS or reverse proxy',
      arrival:
        'open-loop primary events; independent of completion, bounded synthetic 503 retries at 100/200 ms; retries and continuations counted separately',
      latency:
        'scheduled arrival to completion, millisecond upper-bound histograms; successful and all terminal events reported separately',
      instrumentation:
        'accept wrapper and handler assertions; bounded route bitset, per-active-event accounting, 1 s SDK resource sampling; generator metadata resides in a separate process',
      groups: '2000 possible groups, 85% group traffic, 20% group hotspot; synthetic assumptions',
    },
  };
  const workers: Worker[] = [];
  let progress: NodeJS.Timeout | undefined;
  const interrupt = () => {
    for (const worker of workers) if (worker.child.connected) worker.child.disconnect();
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  let nonce = 0;
  const snapshot = async (worker: Worker, type: string) => {
    const id = String(++nonce);
    worker.send({ type: 'snapshot', nonce: id });
    return worker.wait(type, 10000, id);
  };
  try {
    const driver = new Worker(['--driver', config.name, `${output}.driver.json`]);
    workers.push(driver);
    const driverReady = await driver.wait('driver-ready');
    assert.equal(typeof driverReady.origin, 'string');
    const sdk = new Worker([
      '--sdk',
      config.name,
      driverReady.origin as string,
      `${output}.sdk.json`,
    ]);
    workers.push(sdk);
    sdk.onMessage = (message) => {
      if (message.type === 'root-done') {
        driver.send(message);
        return true;
      }
      return false;
    };
    driver.onMessage = (message) => {
      if (message.type === 'phase') {
        console.log(`mixed benchmark: ${String(message.name)}`);
        return true;
      }
      return false;
    };
    const sdkReady = await sdk.wait('sdk-ready');
    const clocks = [];
    for (const worker of workers) {
      const before = now();
      const id = String(++nonce);
      worker.send({ type: 'clock', nonce: id });
      const value = await worker.wait('clock', 5000, id);
      const after = now();
      assert.equal(typeof value.atNs, 'string');
      const child = BigInt(value.atNs as string);
      assert.ok(child >= before && child <= after, 'Monotonic clocks do not share an epoch');
      clocks.push({ pid: worker.child.pid, roundTripMs: Number(after - before) / 1e6 });
    }
    report.clockChecks = clocks;
    driver.send({ type: 'configure', origin: sdkReady.origin });
    const startNs = now() + 300_000_000n;
    report.startNs = startNs.toString();
    sdk.send({ type: 'begin', startNs: startNs.toString() });
    driver.send({ type: 'begin', startNs: startNs.toString() });
    const duration = config.phases.reduce((sum, p) => sum + p.durationMs, 0);
    console.log(
      `mixed benchmark: ${config.name}, ${(duration / 1000).toFixed(1)} s, SDK pid ${String(sdk.child.pid)}, driver pid ${String(driver.child.pid)}`,
    );
    progress = setInterval(() => {
      snapshot(sdk, 'sdk-snapshot')
        .then((message) => {
          const data = object(message.data),
            resources = object(data.resources);
          console.log(
            `mixed benchmark: elapsed ${(elapsedMs(startNs) / 1000).toFixed(0)} s, active ${String(resources.active)}, queued ${String(resources.pending)}, prompts ${String(resources.prompts)}, RSS ${(Number(object(data.memory).rss) / 1048576).toFixed(1)} MiB`,
          );
        })
        .catch((error) => console.error(error));
    }, 15000);
    await driver.wait('load-finished', duration + 30000);
    clearInterval(progress);
    const drainStart = now();
    for (;;) {
      const state = await snapshot(sdk, 'sdk-snapshot');
      const resources = object(object(state.data).resources);
      const driverState = await snapshot(driver, 'driver-snapshot');
      if (
        resources.active === 0 &&
        resources.pending === 0 &&
        resources.prompts === 0 &&
        driverState.outstanding === 0 &&
        driverState.timers === 0
      ) {
        report.afterLoad = state.data;
        report.drainMs = elapsedMs(drainStart);
        break;
      }
      assert.ok(elapsedMs(drainStart) < 25000, 'Normal load did not drain in 25 seconds');
      await sleep(100);
    }
    if (process.env.DOU_BOT_BENCHMARK_CORRUPT_DATA === '1') {
      // Preserve final error evidence without depending on working shutdown prompts.
      sdk.send({ type: 'close' });
      report.sdk = await result(sdk, 'sdk-final', `${output}.sdk.json`);
      driver.send({ type: 'finish' });
      report.driver = await result(driver, 'driver-final', `${output}.driver.json`);
      report.negativeControlDetected =
        Number(object(object(report.sdk).globalCounts).unexpected) > 0;
      assert.equal(
        report.negativeControlDetected,
        true,
        'Negative control was not detected by the assertions',
      );
      throw new Error('Negative control: corrupted identity fixture must not pass');
    }
    driver.send({ type: 'shutdown-prompts' });
    const shutdownStart = now();
    for (;;) {
      const state = await snapshot(sdk, 'sdk-snapshot');
      if (Number(object(object(state.data).resources).prompts) >= Math.min(8, config.concurrency))
        break;
      assert.ok(elapsedMs(shutdownStart) < 5000, 'Shutdown prompts did not register');
      await sleep(20);
    }
    driver.send({ type: 'shutdown-holds' });
    for (;;) {
      const state = await snapshot(sdk, 'sdk-snapshot');
      const resources = object(object(state.data).resources);
      if (Number(resources.active) === config.concurrency && Number(resources.pending) > 0) {
        report.shutdownStart = state.data;
        break;
      }
      assert.ok(
        elapsedMs(shutdownStart) < 6000,
        'Shutdown workload did not fill active and queued slots',
      );
      await sleep(20);
    }
    const closeStart = now();
    sdk.send({ type: 'close' });
    const sdkFinal = object(await result(sdk, 'sdk-final', `${output}.sdk.json`));
    report.sdk = sdkFinal;
    report.closeMs = elapsedMs(closeStart);
    driver.send({ type: 'finish' });
    const driverFinal = object(await result(driver, 'driver-final', `${output}.driver.json`));
    report.driver = driverFinal;
    await Promise.all(workers.map((worker) => worker.exited));
    for (const worker of workers)
      assert.equal(worker.child.exitCode, 0, 'Worker exited unsuccessfully');
    const sdkCounts = object(sdkFinal.globalCounts),
      driverCounts = object(driverFinal.counts);
    assert.equal(sdkCounts.unexpected ?? 0, 0, JSON.stringify(sdkFinal.unexpected));
    assert.equal(driverCounts.unexpected ?? 0, 0, JSON.stringify(driverFinal.errors));
    assert.equal(driverFinal.maximumTokenActive, 1, 'Token refresh was not single-flight');
    assert.equal(
      object(sdkFinal.closeError).code,
      'SHUTDOWN_TIMEOUT',
      'Forced shutdown deadline was not exercised',
    );
    assert.ok(Number(driverFinal.tokenCount) > 1, 'Token refresh not exercised');
    for (const key of [
      'uploads',
      'buttonAcks',
      'http429Injected',
      'http503Injected',
      'dataTimeoutsInjected',
      'apiTimeoutsInjected',
    ])
      assert.ok(Number(driverCounts[key]) > 0, `No coverage: ${key}`);
    for (const key of ['prompt:received', 'prompt:cancelled', 'prompt:timeout'])
      assert.ok(Number(sdkCounts[key]) > 0, `No coverage: ${key}`);
    assert.ok(Array.isArray(driverFinal.phases));
    assert.ok(Array.isArray(sdkFinal.phases));
    const sdkPhases = sdkFinal.phases.map(object);
    for (const route of [
      'query',
      'admin',
      'images',
      'file',
      'audit',
      'button',
      'picture',
      'prompt',
      'failure',
    ]) {
      assert.ok(
        sdkPhases.some((p) => Number(object(p.routes)[route] ?? 0) > 0),
        `No handler coverage: ${route}`,
      );
    }
    for (const status of ['duplicate', 'overloaded']) {
      assert.ok(
        sdkPhases.some((p) => Number(object(p.admissions)[status] ?? 0) > 0),
        `No admission coverage: ${status}`,
      );
    }
    assert.equal(
      driverFinal.phases.reduce(
        (sum: number, p: unknown) => sum + Number(object(object(p).counts).driverDropped ?? 0),
        0,
      ),
      0,
      'Generator dropped offered traffic',
    );
    report.integrity = 'passed';
  } catch (error) {
    report.integrity = 'failed';
    report.failure =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : String(error);
    throw error;
  } finally {
    if (progress) clearInterval(progress);
    await Promise.all(workers.map((worker) => worker.stop()));
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    report.finishedAt = new Date().toISOString();
    await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(`mixed benchmark report: ${output}`);
  }
}

if (role === '--driver') {
  const { runDriver } = await import('./mixed-benchmark/driver.js');
  assert.ok(process.argv[4]);
  await runDriver(profile(process.argv[3] ?? 'smoke'), process.argv[4]);
} else if (role === '--sdk') {
  const { runSdk } = await import('./mixed-benchmark/sdk.js');
  assert.ok(process.argv[4] && process.argv[5]);
  await runSdk(profile(process.argv[3] ?? 'smoke'), process.argv[4], process.argv[5]);
} else {
  await main();
}
