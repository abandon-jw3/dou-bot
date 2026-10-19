import { createHash, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { AppFactory, migrateDatabase } from '../src/index.js';
import {
  MultiBotProbe,
  multiBotProbeModule,
  probeDatabase,
  probeError,
  probeOptions,
} from './multi-bot-probe.js';
import type { ProbeAccount, ProbeRecord } from './multi-bot-probe.js';
import { probeFeed } from './multi-bot-probe-feed.js';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !['--check', '--migrate'].includes(args[0]!)))
  throw new Error('Use --check, --migrate, or no argument for live acceptance');
// Read this file directly so inherited business/retired test settings cannot replace it.
const values = parseEnv(await readFile(resolve('.env'), 'utf8'));
if (args[0] === '--migrate') {
  try {
    await migrateDatabase(probeDatabase(values));
    console.log(JSON.stringify({ event: 'probe-schema-migrated' }));
  } catch (error) {
    console.log(JSON.stringify({ event: 'probe-migration-failed', ...probeError(error) }));
    process.exitCode = 1;
  }
} else {
  const config = probeOptions(values);
  const nonce = randomBytes(4).toString('hex');
  const records: ProbeRecord[] = [];
  let dropped = 0;
  const record = (entry: ProbeRecord) => {
    const event = { at: new Date().toISOString(), ...entry };
    if (records.length < 256) records.push(event);
    else dropped++;
    console.log(JSON.stringify(event));
  };
  const root = multiBotProbeModule({ accounts: config.accounts, nonce, record });
  const app = await AppFactory.create(root, {
    ...config.options,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    onError: (error, context) =>
      record({
        event: 'framework-error',
        phase: context.phase,
        account:
          context.appId === config.accounts.A
            ? 'A'
            : context.appId === config.accounts.B
              ? 'B'
              : undefined,
        ...probeError(error),
      }),
  });
  if (args[0] === '--check') {
    await app.close();
    record({ event: 'configuration-valid', accounts: ['A', 'B'], transports: ['ws', 'ws'] });
  } else {
    const directory = resolve('work/live-multi-bot', nonce);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let session: MultiBotProbe | undefined;
    let feed: Awaited<ReturnType<typeof probeFeed>> | undefined;
    let terminal: ReturnType<typeof createInterface> | undefined;
    let timer: NodeJS.Timeout | undefined;
    let source: ProbeRecord | undefined;
    let closing: Promise<void> | undefined;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const status = () =>
      record({
        event: 'status',
        accounts: (['A', 'B'] as const).map((alias) => ({
          account: alias,
          status: app.bots.get(config.accounts[alias]).status,
        })),
        ...(session?.snapshot() ?? {}),
      });
    const close = (reason: string): Promise<void> => {
      if (closing) return closing;
      closing = (async () => {
        if (timer) clearTimeout(timer);
        terminal?.close();
        await feed?.close();
        try {
          await app.close();
        } catch (error) {
          record({ event: 'close-error', ...probeError(error) });
          process.exitCode = 1;
        }
        record({ event: 'closed', reason });
        await writeFile(
          resolve(directory, 'report.json'),
          JSON.stringify(
            {
              nonce,
              source,
              records,
              dropped,
              receivers: session?.snapshot(),
              scope:
                'Live two-account probe; client receipt and same physical group require user confirmation. IDs and payloads are not recorded.',
            },
            null,
            2,
          ) + '\n',
          { mode: 0o600 },
        );
      })().finally(finish);
      return closing;
    };
    const interrupt = () => {
      void close('signal').catch(() => {
        process.exitCode = 1;
      });
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    try {
      const digest = async (files: readonly string[]) => {
        const hash = createHash('sha256');
        for (const path of [...files].sort())
          hash
            .update(path)
            .update('\0')
            .update(await readFile(path))
            .update('\0');
        return hash.digest('hex');
      };
      const sdkFiles = (await readdir('src', { recursive: true }))
        .filter((path) => path.endsWith('.ts'))
        .map((path) => `src/${path.replaceAll('\\', '/')}`);
      source = {
        node: process.version,
        commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()),
        sdkSha256: await digest(sdkFiles),
        probeSha256: await digest([
          'examples/live-multi-bot.ts',
          'examples/multi-bot-probe.ts',
          'examples/multi-bot-probe-feed.ts',
        ]),
      };
      await app.start();
      if (app.status !== 'running') throw new Error('Both probe accounts must start successfully');
      session = app.get(MultiBotProbe);
      const shared = session;
      feed = await probeFeed((sequence) => shared.pushGroups(sequence));
      if (closing) {
        await feed.close();
      } else {
        terminal = createInterface({ input: process.stdin });
        let commands = Promise.resolve();
        terminal.on('line', (line) => {
          commands = commands
            .then(async () => {
              if (closing) return;
              const [command, account, extra] = line.trim().split(/\s+/u);
              if (command === 'quit') {
                await close('requested');
                return;
              }
              if (command === 'status') {
                status();
                return;
              }
              if (command === 'routes') {
                await shared.verifyRoutes();
                return;
              }
              if (command === 'push') {
                await feed!.send();
                return;
              }
              if (
                ['stop', 'start'].includes(command ?? '') &&
                ['A', 'B'].includes(account ?? '') &&
                !extra
              ) {
                const bot = app.bots.get(config.accounts[account as ProbeAccount]);
                if (command === 'stop') await bot.stop();
                else await bot.start();
                record({
                  event: 'account-control',
                  action: command,
                  account,
                  sharedProviderRetained: app.get(MultiBotProbe) === shared,
                });
                status();
                return;
              }
              record({ event: 'unknown-control' });
            })
            .catch((error) => record({ event: 'control-failed', ...probeError(error) }));
        });
        timer = setTimeout(() => {
          void close('timeout').catch(() => {
            process.exitCode = 1;
          });
        }, config.timeoutMs);
        record({
          event: 'ready',
          nonce,
          command: `/多机验收 ${nonce}`,
          controls: ['status', 'routes', 'push', 'stop A', 'start A', 'stop B', 'start B', 'quit'],
        });
        status();
        await finished;
      }
    } catch (error) {
      record({ event: 'probe-failed', ...probeError(error) });
      process.exitCode = 1;
    } finally {
      await close('finished');
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    }
  }
}
