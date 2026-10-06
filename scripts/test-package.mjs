import { mkdir, readFile, writeFile, realpath, access } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import ts from 'typescript';
import { root, runNode } from './paths.mjs';

if (
  process.argv
    .slice(2)
    .some((argument) => !['--released-baseline', '--published'].includes(argument))
)
  throw new Error('Unknown package check argument');
const releasedBaseline = process.argv.includes('--released-baseline');
const published = process.argv.includes('--published');
if (releasedBaseline && published) throw new Error('Choose one registry validation target');
const output = resolve(root, 'work', 'package-check', randomUUID());
const consumer = resolve(output, 'consumer');
await mkdir(consumer, { recursive: true });
await access(resolve(root, 'dist', 'index.js'));
const executable = await realpath(process.execPath);
const candidates = [
  process.env.npm_execpath,
  resolve(dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js'),
].filter(Boolean);
let npmCli;
for (const candidate of candidates) {
  if (!candidate.endsWith('npm-cli.js')) continue;
  try {
    await access(candidate);
    npmCli = candidate;
    break;
  } catch {}
}
if (!npmCli) throw new Error('Cannot locate the npm CLI; run this command through npm.');
function npm(args, cwd, capture = false) {
  return new Promise((resolvePromise, reject) => {
    let outputText = '';
    const child = spawn(process.execPath, [npmCli, ...args], {
      cwd,
      stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    });
    if (capture) {
      child.stdout.on('data', (data) => {
        outputText += data.toString();
      });
      child.stderr.on('data', () => {});
    }
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise(outputText)
        : reject(new Error(`npm ${args[0]} failed (${code})`)),
    );
  });
}
const pack = JSON.parse(
  await npm(['pack', '--json', '--ignore-scripts', '--pack-destination', output], root, true),
)[0];
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
if (pack.name !== 'dou-bot' || manifest.private || manifest.license !== 'MIT')
  throw new Error('Package identity, visibility or license is not ready for distribution');
const publicGuides = [
  'docs/command-parameters.md',
  'docs/execution-controls.md',
  'docs/access-control.md',
  'docs/prompts.md',
  'docs/module-guards.md',
];
const packagePaths = new Set(pack.files.map((file) => file.path));
for (const required of [
  'LICENSE',
  'NOTICE',
  'README.md',
  'package.json',
  ...publicGuides,
  ...Object.values(manifest.exports).flatMap((entry) => [entry.types, entry.import]),
]) {
  if (!packagePaths.has(required.replace(/^\.\//u, '')))
    throw new Error(`Missing required package file: ${required}`);
}
const env = await readFile(resolve(root, '.env'), 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const secrets = [parseEnv(env).QQ_APP_SECRET, process.env.QQ_APP_SECRET].filter(Boolean);
for (const file of pack.files) {
  if (
    !/^(dist\/|package\.json$|README\.md$|LICENSE$|NOTICE$)/.test(file.path) &&
    !publicGuides.includes(file.path)
  )
    throw new Error(`Unexpected package file: ${file.path}`);
  const content = await readFile(resolve(root, file.path));
  for (const secret of secrets)
    if (secret && content.includes(Buffer.from(secret)))
      throw new Error(`Credential detected in package file: ${file.path}`);
  if (file.path.endsWith('.md')) {
    for (const match of content.toString('utf8').matchAll(/\]\((?:<([^>]+)>|([^\s)]+))\)/g)) {
      const target = match[1] ?? match[2];
      if (!target || /^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
      const local = decodeURIComponent(target.split('#')[0].split('?')[0]);
      if (!local) continue;
      const linked = posix.normalize(posix.join(posix.dirname(file.path), local));
      if (!packagePaths.has(linked))
        throw new Error(`Document link leaves the installed package: ${file.path} -> ${target}`);
    }
  }
}
const tarball = resolve(output, pack.filename);
await writeFile(
  resolve(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'dou-bot-independent-consumer',
      private: true,
      type: 'module',
      dependencies: {
        'dou-bot': releasedBaseline
          ? '0.6.0'
          : published
            ? manifest.version
            : `file:${relative(consumer, tarball).replaceAll('\\', '/')}`,
      },
      devDependencies: { '@types/node': '24.19.0' },
    },
    null,
    2,
  ),
);
if (published) {
  await writeFile(resolve(output, 'npmrc'), '');
  await writeFile(resolve(output, 'global-npmrc'), '');
}
await npm(
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--registry=https://registry.npmjs.org/',
    '--cache',
    published
      ? resolve(output, 'fresh-npm-cache')
      : resolve(root, 'work', 'stack-selection', 'npm-cache'),
    ...(published
      ? [
          '--userconfig',
          resolve(output, 'npmrc'),
          '--globalconfig',
          resolve(output, 'global-npmrc'),
        ]
      : []),
  ],
  consumer,
);
await writeFile(
  resolve(consumer, 'consumer.ts'),
  await readFile(resolve(root, 'scripts/fixtures/consumer-v0.6.0.ts')),
);
const compilerOptions = {
  target: ts.ScriptTarget.ES2023,
  lib: ['lib.es2023.d.ts'],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  experimentalDecorators: true,
  emitDecoratorMetadata: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  typeRoots: [resolve(consumer, 'node_modules/@types')],
  types: ['node'],
  outDir: resolve(consumer, 'out'),
  skipLibCheck: false,
};
const skillExamples = [
  'minimal-module.ts',
  'minimal-module.test.ts',
  ...(releasedBaseline ? [] : ['attachments-module.ts', 'attachments-module.test.ts']),
];
const currentTypes = releasedBaseline ? [] : ['testing-types.ts'];
const featureConsumers = releasedBaseline
  ? []
  : ['consumer-attachments.ts', 'consumer-identity.ts', 'consumer-attachment-routes.ts'];
if (!releasedBaseline) {
  await writeFile(
    resolve(consumer, 'testing-types.ts'),
    `
import type { TestAdmission, TestHarness } from 'dou-bot/testing';
export function completion(harness: TestHarness, result: TestAdmission): Promise<void> {
  if ('done' in result) return result.done;
  return harness.flush();
}
`,
  );
}
for (const name of skillExamples) {
  await writeFile(
    resolve(consumer, name),
    await readFile(resolve(root, 'skills', 'dou-bot', 'assets', name)),
  );
}
for (const name of featureConsumers) {
  await writeFile(
    resolve(consumer, name),
    await readFile(resolve(root, 'scripts', 'fixtures', name)),
  );
}
const program = ts.createProgram(
  [
    resolve(consumer, 'consumer.ts'),
    ...[...skillExamples, ...currentTypes, ...featureConsumers].map((name) =>
      resolve(consumer, name),
    ),
  ],
  compilerOptions,
);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  throw new Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => consumer,
      getNewLine: () => '\n',
    }),
  );
}
const libraryRoot = dirname(ts.getDefaultLibFilePath(compilerOptions));
for (const file of program.getSourceFiles()) {
  const local = relative(consumer, file.fileName);
  const library = relative(libraryRoot, file.fileName);
  if (
    (!local.startsWith('..') && !isAbsolute(local)) ||
    (!library.startsWith('..') && !isAbsolute(library))
  )
    continue;
  throw new Error(
    `Consumer resolved an undeclared dependency outside its installation: ${file.fileName}`,
  );
}
program.emit();
await runNode([resolve(consumer, 'out', 'consumer.js')], { cwd: consumer });
for (const name of featureConsumers)
  await runNode([resolve(consumer, 'out', name.replace(/\.ts$/u, '.js'))], { cwd: consumer });
await runNode(
  [
    '--test',
    ...skillExamples
      .filter((name) => name.endsWith('.test.ts'))
      .map((name) => resolve(consumer, 'out', name.replace(/\.ts$/u, '.js'))),
  ],
  { cwd: consumer },
);
console.log(`Package consumer passed; ${pack.files.length} allowed files, no credential matches.`);
console.log(
  releasedBaseline
    ? 'Historical consumer verified against published dou-bot@0.6.0.'
    : published
      ? `All consumers verified against published dou-bot@${manifest.version} using empty npm configuration and fresh cache.`
      : 'Historical 0.6.0 consumer verified against the current tarball.',
);
