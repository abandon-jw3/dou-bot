import { writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import type { QQDispatch } from '../src/contracts.js';

const beforeImport = process.memoryUsage().rss;
const importStarted = performance.now();
const { Command, Controller, Module } = await import('../src/index.js');
const { Application } = await import('../src/core/application.js');
const importMs = performance.now() - importStarted;

@Controller()
class Commands {
  @Command('noop') noop(): void {}
  @Command('reply') reply(): string {
    return 'pong';
  }
}
@Module({ controllers: [Commands] })
class Root {}

const samples: Record<string, unknown>[] = [];
for (const command of ['noop', 'reply']) {
  let sends = 0;
  let failures = 0;
  const creationStarted = performance.now();
  const app = await Application.create(
    Root,
    {
      appId: 'benchmark-fixture',
      secret: 'benchmark-fixture-secret',
      logger: {
        debug() {},
        info() {},
        warn() {},
        error() {
          failures++;
        },
      },
    },
    {
      transport: () => ({ start: () => Promise.resolve(), stop: () => Promise.resolve() }),
      fetch: (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.endsWith('/app/getAppAccessToken'))
          return Promise.resolve(
            Response.json({ access_token: 'benchmark-fixture-token', expires_in: 7200 }),
          );
        sends++;
        return Promise.resolve(Response.json({ id: `sent-${sends}` }));
      },
    },
  );
  const createMs = performance.now() - creationStarted;
  const startup = performance.now();
  await app.start();
  const startMs = performance.now() - startup;
  let peakRss = process.memoryUsage().rss;
  const dispatch = async (index: number) => {
    const event: QQDispatch = {
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: {
        id: `message-${index}`,
        author: { id: 'fixture-user' },
        content: `/${command}`,
      },
    };
    const result = app.execution.accept(event, Buffer.byteLength(JSON.stringify(event)));
    if (result.status !== 'accepted')
      throw new Error(`Unexpected benchmark admission: ${result.status}`);
    await result.done;
  };
  try {
    for (let index = 0; index < 200; index++) await dispatch(index);
    const durationStart = performance.now();
    for (let index = 200; index < 5200; index++) {
      await dispatch(index);
      if (index % 100 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    const durationMs = performance.now() - durationStart;
    if (failures || sends !== (command === 'reply' ? 5200 : 0))
      throw new Error('Benchmark workload failed');
    samples.push({
      command,
      warmup: 200,
      iterations: 5000,
      createMs,
      startMs,
      durationMs,
      eventsPerSecond: 5_000_000 / durationMs,
      sampledPeakRssBytes: peakRss,
      queue: app.snapshot().queue,
    });
  } finally {
    await app.close();
  }
}
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model,
  importMs,
  rssBeforeImportBytes: beforeImport,
  workload:
    'Serial synthetic QQ dispatch; native Response bodies with no real network; default queue/cache capacities; sampled RSS includes Node and retained dedup/reply state.',
  samples,
};
await writeFile('work/benchmark-latest.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
