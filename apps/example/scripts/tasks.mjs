import { spawn } from 'node:child_process';
import { realpath, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
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
switch (process.argv[2]) {
  case 'build':
    await build();
    break;
  case 'test':
    await test();
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
      'vendor/*.json',
      'vendor/*.md',
      '*.json',
      '*.mjs',
      '*.md',
    ]);
    await build();
    await test();
    break;
  default:
    throw new Error('Unknown task');
}
