import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  comparisonProfile,
  elapsedMs,
  finishReport,
  now,
  plannedMeta,
  record,
  send,
} from './common.js';
import type { Profile } from './common.js';
import { runDriver } from './driver.js';
import { startFixture } from './fixture.js';
import { receiveFrames, sendFrame } from './frames.js';
import { runSdk } from './sdk.js';
import { Worker } from './worker.js';
import { fingerprint } from './fingerprint.js';
import type { Message } from './worker.js';

const [role, token, destination, origin] = process.argv.slice(2);
assert.ok(token && /^[A-Za-z0-9_-]{1,2048}$/u.test(token));
const config = comparisonProfile(
  JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as unknown,
);
assert.ok(destination);

async function fixtureWorker(profile: Profile, output: string): Promise<void> {
  let startNs: bigint | undefined;
  const fixture = await startFixture(profile, {
    plan: (id) => plannedMeta(id, profile),
    phaseOf() {
      let elapsed = startNs === undefined ? 0 : elapsedMs(startNs);
      for (let index = 0; index < profile.phases.length; index++) {
        elapsed -= profile.phases[index]!.durationMs;
        if (elapsed < 0) return index;
      }
      return profile.phases.length;
    },
    question: (root, step) => send({ type: 'question', root, step }),
  });
  let closing: Promise<void> | undefined;
  const close = () =>
    (closing ??= (async () => {
      const report = await fixture.close();
      await finishReport('fixture-final', report, output);
      process.disconnect?.();
    })());
  process.on('message', (message: unknown) => {
    if (!record(message)) return;
    if (message.type === 'clock')
      send({ type: 'clock', nonce: message.nonce, atNs: now().toString() });
    if (message.type === 'begin' && typeof message.startNs === 'string')
      startNs = BigInt(message.startNs);
    if (message.type === 'snapshot')
      send({ type: 'fixture-snapshot', nonce: message.nonce, data: fixture.activity() });
    if (message.type === 'close')
      void close().catch((error: unknown) => {
        console.error(error);
        process.exitCode = 1;
      });
  });
  process.once('disconnect', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  send({ type: 'fixture-ready', origin: fixture.origin, pid: process.pid });
}

async function host(output: string): Promise<void> {
  assert.ok(process.version.startsWith('v24.'), 'Use the supported Node 24 runtime');
  assert.ok(
    resolve(output).startsWith(resolve('work/distributed') + sep),
    'Reports must stay in work/distributed',
  );
  await mkdir(output, { recursive: true });
  await writeFile(
    resolve(output, 'run.json'),
    JSON.stringify({ configuration: config, startedAt: new Date().toISOString() }) + '\n',
    { flag: 'wx' },
  );
  const workers = new Map<string, Worker>();
  let stopping: Promise<void> | undefined;
  const stop = () =>
    (stopping ??= Promise.all([...workers.values()].map((worker) => worker.stop())).then(() => {}));
  const requestStop = () => {
    void stop().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  const abort = (error: unknown) => {
    console.error(error);
    process.exitCode = 1;
    requestStop();
  };
  const dispatch = (frame: Message) => {
    assert.ok(typeof frame.role === 'string' && record(frame.message));
    if (frame.role === 'control' && frame.message.type === 'stop') {
      requestStop();
      return;
    }
    const worker = workers.get(frame.role);
    assert.ok(worker, 'Unknown benchmark worker channel');
    worker.send(frame.message);
  };
  const detach = receiveFrames(process.stdin, dispatch, abort);
  process.stdin.once('end', () => {
    requestStop();
  });
  process.stdout.on('error', abort);
  const interrupted = () => {
    requestStop();
  };
  process.once('SIGINT', interrupted);
  process.once('SIGTERM', interrupted);
  const entry = fileURLToPath(import.meta.url);
  const makeWorker = (name: string, args: string[]) => {
    const worker = new Worker(args, entry);
    workers.set(name, worker);
    worker.onMessage = (message) => {
      sendFrame(process.stdout, { role: name, message });
      return message.type !== `${name}-ready`;
    };
    void worker.exited
      .then(() => {
        sendFrame(process.stdout, {
          role: name,
          message: {
            type: 'worker-exit',
            code: worker.child.exitCode,
            signal: worker.child.signalCode,
          },
        });
      })
      .catch(abort);
    return worker;
  };
  try {
    const fixture = makeWorker('fixture', ['--fixture', token!, resolve(output, 'fixture.json')]);
    const fixtureReady = await fixture.wait('fixture-ready');
    assert.equal(typeof fixtureReady.origin, 'string');
    if (stopping) throw new Error('Host stopped during startup');
    const sdk = makeWorker('sdk', [
      '--sdk',
      token!,
      resolve(output, 'sdk.json'),
      fixtureReady.origin as string,
    ]);
    const sdkReady = await sdk.wait('sdk-ready');
    sendFrame(process.stdout, {
      role: 'control',
      message: {
        type: 'host-ready',
        sdk: sdkReady,
        fixture: fixtureReady,
        configuration: config,
        source: await fingerprint(),
        environment: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: os.cpus()[0]?.model,
          logicalCpus: os.cpus().length,
          totalMemoryBytes: os.totalmem(),
        },
      },
    });
    await Promise.all([...workers.values()].map((worker) => worker.exited));
    const exits = Object.fromEntries(
      [...workers].map(([name, worker]) => [name, worker.child.exitCode]),
    );
    if (Object.values(exits).some((code) => code !== 0)) process.exitCode = 1;
    sendFrame(process.stdout, { role: 'control', message: { type: 'host-final', exits } });
    await new Promise<void>((resolve, reject) =>
      process.stdout.write('', (error) => (error ? reject(error) : resolve())),
    );
  } finally {
    await stop();
    detach();
    process.stdin.pause();
    process.stdin.unref?.();
    process.removeListener('SIGINT', interrupted);
    process.removeListener('SIGTERM', interrupted);
  }
}

try {
  if (role === '--fixture') await fixtureWorker(config, destination);
  else if (role === '--sdk') {
    assert.ok(origin && /^http:\/\/127\.0\.0\.1:\d+$/u.test(origin));
    await runSdk(config, origin, destination, true);
  } else if (role === '--driver') await runDriver(config, destination, true);
  else {
    assert.equal(role, '--host');
    await host(destination);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
