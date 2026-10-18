import { mkdir, writeFile } from 'node:fs/promises';
import { cpus } from 'node:os';
import type { ContextMiddleware, MiddlewareContext, QQDispatch } from '../src/contracts.js';

const beforeImport = process.memoryUsage().rss;
const importStarted = performance.now();
const {
  Command,
  Controller,
  Module,
  Slot,
  Option,
  Rest,
  ContextValue,
  createContextKey,
  Injectable,
  UseMiddleware,
  image,
} = await import('../src/index.js');
const { SingleTestApplication: Application } = await import('../src/testing/single-bot.js');
const importMs = performance.now() - importStarted;
const rounds = Number(process.argv[2] ?? 5);
const label = process.argv[3] ?? 'latest';
if (!Number.isSafeInteger(rounds) || rounds < 1 || rounds > 9 || !/^[a-z0-9-]+$/u.test(label))
  throw new Error('Usage: benchmark:framework [rounds 1-9] [output-label]');

const VALUE = createContextKey<string>('benchmark.value');
const bytes = new Uint8Array(65536);
const vocabulary = [...Array.from({ length: 512 }, (_, index) => `word-${index}`), 'chosen'];
let handled = 0;
let loads = 0;
@Injectable()
class Data implements ContextMiddleware {
  prepare(ctx: MiddlewareContext): void {
    ctx.state.provide(VALUE, () => {
      loads++;
      return 'value';
    });
  }
}
@Controller()
class Commands {
  @Command('noop') noop(): void {
    handled++;
  }
  @Command('reply') reply(): string {
    handled++;
    return 'pong';
  }
  @Command('pressure') pressure(): void {
    handled++;
  }
  @Command('choice') choice(
    @Slot('word', { choices: vocabulary, required: true }) word: string,
  ): void {
    if (word !== 'chosen') throw new Error('Enumeration changed');
    handled++;
  }
  @Command('typed') typed(
    @Slot('word', { choices: ['word', 'alias'], required: true, normalize: () => 'word' })
    word: string,
    @Option('page', { type: 'integer', default: 1 }) page: number,
    @Rest() rest: string[],
  ): void {
    if (word !== 'word' || page !== 2 || rest[0] !== 'note') throw new Error('Binding changed');
    handled++;
  }
  @Command('context')
  @UseMiddleware(Data)
  context(@ContextValue(VALUE) a: string, @ContextValue(VALUE) b: string): void {
    if (a !== 'value' || a !== b) throw new Error('Context changed');
    handled++;
  }
  @Command('unused') @UseMiddleware(Data) unused(): void {
    handled++;
  }
  @Command('image') picture() {
    handled++;
    return image(bytes);
  }
}
@Module({ controllers: [Commands], providers: [Data] })
class Root {}

const samples: {
  command: string;
  round: number;
  warmup: number;
  iterations: number;
  durationMs: number;
  eventsPerSecond: number;
  createMs: number;
  startMs: number;
  sampledPeakRssBytes: number;
}[] = [];
for (let round = 0; round < rounds; round++) {
  for (const command of [
    'noop',
    'reply',
    'typed',
    'choice',
    'context',
    'unused',
    'image',
    'pressure',
  ]) {
    global.gc?.();
    let sends = 0;
    let uploads = 0;
    let failures = 0;
    handled = 0;
    loads = 0;
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
          if (url.endsWith('/files')) {
            uploads++;
            return Promise.resolve(Response.json({ file_info: 'fixture-image', ttl: 60 }));
          }
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
    const warmup = command === 'image' ? 100 : command === 'pressure' ? 10000 : 500;
    const iterations = command === 'image' ? 500 : command === 'pressure' ? 2000 : 5000;
    const dispatch = async (index: number) => {
      const event: QQDispatch = {
        op: 0,
        t: 'C2C_MESSAGE_CREATE',
        d: {
          id: `message-${index}`,
          author: { id: 'fixture-user' },
          content:
            command === 'typed'
              ? '/typed alias --page 2 note'
              : command === 'choice'
                ? '/choice chosen'
                : `/${command}`,
        },
      };
      const result = app.execution.accept(event, Buffer.byteLength(JSON.stringify(event)));
      const expected = command === 'pressure' && index >= warmup ? 'overloaded' : 'accepted';
      if (result.status !== expected)
        throw new Error(`Unexpected benchmark admission: ${result.status}`);
      if ('done' in result) await result.done;
    };
    try {
      for (let index = 0; index < warmup; index++) await dispatch(index);
      const started = performance.now();
      for (let index = warmup; index < warmup + iterations; index++) {
        await dispatch(index);
        if (index % 100 === 0) peakRss = Math.max(peakRss, process.memoryUsage().rss);
      }
      const durationMs = performance.now() - started;
      const total = warmup + iterations;
      if (
        failures ||
        handled !== (command === 'pressure' ? warmup : total) ||
        sends !== (['reply', 'image'].includes(command) ? total : 0) ||
        uploads !== (command === 'image' ? total : 0) ||
        loads !== (command === 'context' ? total : 0)
      )
        throw new Error('Benchmark workload failed');
      samples.push({
        command,
        round,
        warmup,
        iterations,
        createMs,
        startMs,
        durationMs,
        eventsPerSecond: (iterations * 1000) / durationMs,
        sampledPeakRssBytes: peakRss,
      });
    } finally {
      await app.close();
    }
  }
}
const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
const summary = [...new Set(samples.map((s) => s.command))].map((command) => {
  const selected = samples.filter((sample) => sample.command === command);
  return {
    command,
    medianEventsPerSecond: median(selected.map((s) => s.eventsPerSecond)),
    medianDurationMs: median(selected.map((s) => s.durationMs)),
  };
});
const result = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  cpu: cpus()[0]?.model,
  importMs,
  rssBeforeImportBytes: beforeImport,
  forcedGcBetweenCases: typeof global.gc === 'function',
  rounds,
  workload:
    'Serial synthetic QQ events; native Response bodies without real networking; 64 KiB synthetic image bytes; a 513-value enumeration; default capacities. The pressure case measures correct overload rejection after filling 10000 retained reply scopes. RSS is sampled, not a peak or leak measurement. Compare identical harnesses on the same host.',
  summary,
  samples,
};
await mkdir('work', { recursive: true });
const output = `work/benchmark-framework-${label}.json`;
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ output, summary }, null, 2));
