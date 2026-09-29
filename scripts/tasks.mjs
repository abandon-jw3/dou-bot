import { spawn } from 'node:child_process';
import { realpath, rm, readdir, readFile, access } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
async function run(args) {
  await new Promise((yes, no) => {
    const process_ = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    process_.once('error', no);
    process_.once('exit', (code) =>
      code === 0 ? yes() : no(new Error(`Command failed: ${args[0]} (${code})`)),
    );
  });
}
async function clean(name) {
  if (!['dist', '.test-build'].includes(name)) throw new Error('Unknown build directory');
  const directory = resolve(root, name);
  const actual = await realpath(directory).catch((error) => {
    if (error.code === 'ENOENT') return directory;
    throw error;
  });
  const within = relative(await realpath(root), actual);
  if (!within || within.startsWith('..') || isAbsolute(within))
    throw new Error('Build path escaped workspace');
  await rm(directory, { recursive: true, force: true });
}
async function build() {
  await clean('dist');
  await run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
}
async function test() {
  await clean('.test-build');
  await run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']);
  await run(['--test', '.test-build/tests/**/*.test.js']);
}
async function docs() {
  for (const name of [
    'README.md',
    ...(await readdir(resolve(root, 'docs')))
      .filter((p) => p.endsWith('.md'))
      .map((p) => `docs/${p}`),
  ]) {
    const path = resolve(root, name);
    const content = await readFile(path, 'utf8');
    for (const match of content.matchAll(/\]\(([^\s)]+)\)/gu)) {
      const link = match[1].split('#')[0];
      if (!link || /^[a-z][a-z\d+.-]*:/iu.test(link)) continue;
      await access(resolve(dirname(path), link));
    }
  }
}
switch (process.argv[2]) {
  case 'build':
    await build();
    break;
  case 'test':
    await test();
    break;
  case 'live':
    await build();
    await run(['--use-env-proxy', '--env-file=.env', 'dist/live.js']);
    break;
  case 'weather':
    await build();
    await run(['--use-env-proxy', 'dist/weather-live.js', ...process.argv.slice(3)]);
    break;
  case 'check':
    await run(['scripts/verify-sdk.mjs']);
    await run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']);
    await run(['node_modules/eslint/bin/eslint.js', 'src', 'tests', '--max-warnings', '0']);
    await run([
      'node_modules/prettier/bin/prettier.cjs',
      '--check',
      'src',
      'tests',
      'scripts',
      'docs',
      '*.json',
      '*.mjs',
      '*.md',
      '.github',
    ]);
    await docs();
    await build();
    await test();
    break;
  default:
    throw new Error('Unknown task');
}
