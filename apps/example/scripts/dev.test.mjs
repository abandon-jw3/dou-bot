import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  symlink,
  access,
  copyFile,
} from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startDev } from './dev.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
async function until(predicate, timeout = 20000) {
  const deadline = performance.now() + timeout;
  while (!(await predicate())) {
    if (performance.now() >= deadline)
      throw new Error('Development process did not reach the expected state');
    await delay(25);
  }
}
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function program(
  version,
  { helper = false, stopDelay = 25, ignoreStop = false, startupDelay = 0 } = {},
) {
  return `
import { appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Injectable, Controller, Command, Module } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
${helper ? "import { value } from './helper.ts';" : ''}
const note = (event: string, extra = {}) => appendFileSync(resolve('events.jsonl'), JSON.stringify({ event, pid: process.pid, version: ${JSON.stringify(version)}, ...extra }) + '\\n');
@Injectable() class Service { prefix = ${JSON.stringify(version)}; }
@Controller() class Commands {
  constructor(private readonly service: Service) {}
  @Command('who') who(): string { return this.service.prefix + ':' + ${helper ? 'value' : "'none'"}; }
}
@Module({ controllers: [Commands], providers: [Service] }) class Root {}
const bot = await createTestApplication(Root);
const hold = setInterval(() => {}, 1000);
let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  note('stopping');
  if (${ignoreStop}) return;
  await delay(${stopDelay});
  await bot.app.close();
  note('stopped');
  clearInterval(hold);
};
const close = () => stop().catch((error) => { console.error(error); process.exitCode = 1; });
process.on('message', (message: unknown) => {
  if (typeof message === 'object' && message !== null && 'type' in message && message.type === 'dou-bot:dev-stop') close();
});
process.on('disconnect', close);
process.on('SIGINT', close);
process.on('SIGTERM', close);
process.send?.({ type: 'dou-bot:dev-ready' });
process.channel?.unref();
note('ready');
await delay(${startupDelay});
if (!stopping) {
await bot.app.start();
await bot.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'probe', content: '/who', author: { user_openid: 'user' } } });
note('started', { result: bot.messages[0]?.payload.content, marker: process.env.DOU_DEV_TEST_VALUE, directory: dirname(fileURLToPath(import.meta.url)) });
}
`;
}
async function fixture(t, source, { run = true, ...options } = {}) {
  await mkdir(join(project, 'work'), { recursive: true });
  const root = await mkdtemp(join(project, 'work/dev-test-'));
  await mkdir(join(root, 'src'));
  await symlink(join(project, 'node_modules'), join(root, 'node_modules'), 'junction');
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'package-lock.json'), '{}');
  await writeFile(join(root, '.env'), 'DOU_DEV_TEST_VALUE=one\n');
  await writeFile(
    join(root, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        rewriteRelativeImportExtensions: true,
        types: ['node'],
        noEmitOnError: true,
      },
    }),
  );
  await writeFile(
    join(root, 'tsconfig.build.json'),
    JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: { rootDir: 'src', outDir: 'dist' },
      include: ['src/**/*.ts'],
    }),
  );
  await writeFile(join(root, 'src/main.ts'), source);
  const errors = [];
  let runner = run
    ? await startDev({
        root,
        debounceMs: 150,
        log() {},
        error: (message) => errors.push(message),
        ...options,
      })
    : undefined;
  const events = async () => {
    const text = await readFile(join(root, 'events.jsonl'), 'utf8').catch(() => '');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  };
  t.after(async () => {
    await runner?.close();
    const remaining = (await events())
      .filter((event) => event.event === 'started')
      .filter((event) => alive(event.pid));
    for (const event of remaining) process.kill(event.pid, 'SIGKILL');
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    assert.deepEqual(remaining, [], 'A development child was left behind');
  });
  return {
    root,
    runner,
    errors,
    events,
    useRunner: (value) => {
      runner = value;
    },
    save: (source) => writeFile(join(root, 'src/main.ts'), source),
    starts: async () => (await events()).filter((event) => event.event === 'started'),
  };
}

await test('dev waits for a valid first build, emits DI metadata and coalesces rapid saves', async (t) => {
  const f = await fixture(t, 'const value: number = "invalid";');
  await until(() => f.errors.length > 0);
  assert.deepEqual(await f.starts(), []);
  await f.save(program('v1'));
  await until(async () => (await f.starts()).length === 1);
  assert.equal((await f.starts())[0].result, 'v1:none');
  await f.save(program('v2'));
  await delay(30);
  await f.save(program('v3'));
  await delay(30);
  await f.save(program('v4'));
  await until(async () => (await f.starts()).length === 2);
  await delay(700);
  assert.deepEqual(
    (await f.starts()).map((event) => event.version),
    ['v1', 'v4'],
  );
  const events = await f.events();
  assert.ok(
    events.findIndex((event) => event.event === 'stopped') <
      events.findIndex((event) => event.event === 'started' && event.version === 'v4'),
  );
});

await test('failed edits retain the running snapshot; deleted files and env changes use a fresh build', async (t) => {
  const f = await fixture(t, program('v1', { helper: true }), { run: false });
  await writeFile(join(f.root, 'src/helper.ts'), "export const value = 'one';");
  const runner = await startDev({
    root: f.root,
    debounceMs: 100,
    log() {},
    error: (message) => f.errors.push(message),
  });
  f.useRunner(runner);
  await until(async () => (await f.starts()).length === 1);
  const first = (await f.starts())[0];
  const before = await readFile(join(first.directory, 'helper.js'), 'utf8');
  await writeFile(join(f.root, 'src/helper.ts'), "export const value: number = 'invalid';");
  await until(() => f.errors.length > 0);
  assert.equal(alive(first.pid), true);
  assert.equal((await f.starts()).length, 1);
  assert.equal(await readFile(join(first.directory, 'helper.js'), 'utf8'), before);
  await f.save(program('v2'));
  await rm(join(f.root, 'src/helper.ts'));
  await until(async () => (await f.starts()).length === 2);
  const second = (await f.starts())[1];
  await assert.rejects(access(join(second.directory, 'helper.js')));
  await writeFile(join(f.root, '.env'), 'DOU_DEV_TEST_VALUE=two\n');
  await until(async () => (await f.starts()).length === 3);
  assert.equal((await f.starts())[2].marker, 'two');
  const config = await readFile(join(f.root, 'tsconfig.json'), 'utf8');
  const errorsBefore = f.errors.length;
  await writeFile(join(f.root, 'tsconfig.json'), '{');
  await until(() => f.errors.length > errorsBefore);
  assert.equal((await f.starts()).length, 3);
  assert.equal(alive((await f.starts())[2].pid), true);
  await writeFile(join(f.root, 'tsconfig.json'), config);
  await until(async () => (await f.starts()).length === 4);
  await runner.close();
});

await test('an invalid save during shutdown restores the old valid code before a later recovery', async (t) => {
  const f = await fixture(t, program('v1', { stopDelay: 600 }));
  await until(async () => (await f.starts()).length === 1);
  await f.save(program('v2'));
  await until(async () => (await f.events()).some((event) => event.event === 'stopping'));
  await f.save('const value: number = "invalid";');
  await until(async () => (await f.starts()).length === 2);
  assert.deepEqual(
    (await f.starts()).map((event) => event.version),
    ['v1', 'v1'],
  );
  await f.save(program('v3'));
  await until(async () => (await f.starts()).length === 3);
  assert.equal((await f.starts())[2].version, 'v3');
});

await test('shutdown bounds an uncooperative child and closes all watchers', async (t) => {
  const f = await fixture(t, program('stubborn', { ignoreStop: true }), { shutdownTimeoutMs: 200 });
  await until(async () => (await f.starts()).length === 1);
  const pid = (await f.starts())[0].pid;
  await f.runner.close();
  assert.equal(alive(pid), false);
  const count = (await f.starts()).length;
  await f.save(program('must-not-start'));
  await writeFile(join(f.root, '.env'), 'DOU_DEV_TEST_VALUE=closed\n');
  await delay(500);
  assert.equal((await f.starts()).length, count);
  assert.ok(f.errors.length > 0);
});

await test('closing during startup reaches the child through its ready handshake', async (t) => {
  const f = await fixture(t, program('slow-start', { startupDelay: 600 }));
  await until(async () => (await f.events()).some((event) => event.event === 'ready'));
  const pid = (await f.events()).find((event) => event.event === 'ready').pid;
  await f.runner.close();
  assert.equal(alive(pid), false);
  assert.deepEqual(await f.starts(), []);
  assert.ok((await f.events()).some((event) => event.event === 'stopped'));
});

await test('closing during compilation terminates the compiler without starting a bot', async (t) => {
  const f = await fixture(t, program('unused'), { run: false });
  // Replace only this fixture's link with a deliberately slow compiler executable.
  await rm(join(f.root, 'node_modules'), { recursive: true, force: true });
  await mkdir(join(f.root, 'node_modules/typescript/bin'), { recursive: true });
  await writeFile(join(f.root, 'node_modules/typescript/package.json'), '{"type":"commonjs"}');
  await writeFile(
    join(f.root, 'node_modules/typescript/bin/tsc'),
    "require('node:fs').writeFileSync('compiler.pid', String(process.pid)); setInterval(() => {}, 1000);",
  );
  const runner = await startDev({ root: f.root, debounceMs: 20, log() {}, error() {} });
  f.useRunner(runner);
  await until(async () =>
    access(join(f.root, 'compiler.pid')).then(
      () => true,
      () => false,
    ),
  );
  const pid = Number(await readFile(join(f.root, 'compiler.pid'), 'utf8'));
  await runner.close();
  assert.equal(alive(pid), false);
  assert.deepEqual(await f.starts(), []);
});

await test(
  'CLI SIGINT waits for child shutdown before exiting',
  { skip: process.platform === 'win32' },
  async (t) => {
    const f = await fixture(t, program('cli', { stopDelay: 100 }), { run: false });
    await mkdir(join(f.root, 'scripts'));
    await copyFile(resolve(project, 'scripts/dev.mjs'), join(f.root, 'scripts/dev.mjs'));
    const child = spawn(process.execPath, ['scripts/dev.mjs'], { cwd: f.root, stdio: 'ignore' });
    t.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });
    const done = new Promise((resolveExit, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolveExit(code));
    });
    await until(async () => (await f.starts()).length === 1);
    const pid = (await f.starts())[0].pid;
    child.kill('SIGINT');
    assert.equal(await done, 0);
    assert.equal(alive(pid), false);
    assert.ok((await f.events()).some((event) => event.event === 'stopped'));
  },
);
