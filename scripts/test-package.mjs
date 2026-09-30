import { mkdir, readFile, writeFile, realpath, access } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import ts from 'typescript';
import { root, runNode } from './paths.mjs';

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
const env = await readFile(resolve(root, '.env'), 'utf8').catch((error) => {
  if (error.code === 'ENOENT') return '';
  throw error;
});
const secrets = [parseEnv(env).QQ_APP_SECRET, process.env.QQ_APP_SECRET].filter(Boolean);
for (const file of pack.files) {
  if (!/^(dist\/|package\.json$|README\.md$|NOTICE$)/.test(file.path))
    throw new Error(`Unexpected package file: ${file.path}`);
  const content = await readFile(resolve(root, file.path));
  for (const secret of secrets)
    if (secret && content.includes(Buffer.from(secret)))
      throw new Error(`Credential detected in package file: ${file.path}`);
}
const tarball = resolve(output, pack.filename);
await writeFile(
  resolve(consumer, 'package.json'),
  JSON.stringify(
    {
      name: 'dd-bot-independent-consumer',
      private: true,
      type: 'module',
      dependencies: { 'dd-bot': `file:${relative(consumer, tarball).replaceAll('\\', '/')}` },
      devDependencies: { '@types/node': '24.19.0' },
    },
    null,
    2,
  ),
);
await npm(
  [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--cache',
    resolve(root, 'work', 'stack-selection', 'npm-cache'),
  ],
  consumer,
);
await writeFile(
  resolve(consumer, 'consumer.ts'),
  `
import assert from 'node:assert/strict';
import { Arg, Command, Controller, Cooldown, Ctx, GroupManagersOnly, HelpModule, Injectable, Module, Option, Rest, Slot, UseGuards } from 'dd-bot';
import type { CanActivate, GuardContext, GuardResult, MessageContext } from 'dd-bot';
import { createTestApplication } from 'dd-bot/testing';
@Injectable() class Greeter { hello(name: string) { return 'Hello ' + name; } }
@Injectable() class Guard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult { return ctx.userId === 'u' || { allow: false, message: 'blocked' }; }
}
@Controller() class Commands {
  constructor(private readonly service: Greeter) {}
  @Command('hello') hello(@Arg(0) name: string) { return this.service.hello(name); }
  @UseGuards(Guard) @Cooldown({ scope: 'user', durationMs: 60000, message: 'wait' })
  @Command('controlled') controlled() { return 'allowed'; }
  @Command('manage') @GroupManagersOnly() manage() { return 'manager'; }
  @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
    const answer = await ctx.prompt('prompt-question');
    if (answer.status === 'received') await answer.message.reply(answer.message.content);
  }
  @Command('query') query(
    @Rest() rest: string[],
    @Slot('city', { choices: ['北京'], required: true }) city: string,
    @Slot('topic', { choices: ['天气'], required: true }) topic: string,
    @Option('page', { type: 'integer', alias: 'p', min: 1, default: 1 }) page: number,
  ) { return JSON.stringify({ city, topic, page, rest }); }
}
@Module({ imports: [HelpModule], providers: [Greeter, Guard], controllers: [Commands] }) class Root {}
const harness = await createTestApplication(Root, { commands: { prefix: '', invalidInput: 'reply' } });
await harness.app.start();
try {
  await harness.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-test', author: { id: 'u' }, content: 'hello package' } });
  assert.equal(harness.messages[0]?.payload.content, 'Hello package');
  assert.equal(harness.errors.length, 0);
  await harness.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-query', author: { id: 'u' }, content: 'query 今天 天气 北京 -p 2' } });
  assert.deepEqual(JSON.parse(harness.messages[1]!.payload.content!), { city: '北京', topic: '天气', page: 2, rest: ['今天'] });
  await harness.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-help', author: { id: 'u' }, content: 'help query' } });
  assert.match(harness.messages[2]!.payload.content!, /用法：query/);
  await harness.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-error', author: { id: 'u' }, content: 'query 北京' } });
  assert.match(harness.messages[3]!.payload.content!, /缺少必填参数/);
  for (const [id, user] of [['deny', 'other'], ['allow', 'u'], ['cooldown', 'u']])
    await harness.dispatch({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { id: user }, content: 'controlled' } });
  assert.deepEqual(harness.messages.slice(4).map(m => m.payload.content), ['blocked', 'allowed', 'wait']);
  await harness.dispatch({ op: 0, t: 'GROUP_MESSAGE_CREATE', d: { id: 'package-manager', group_openid: 'g', author: { member_openid: 'u', member_role: 'owner' }, content: 'manage' } });
  assert.equal(harness.messages[7]?.payload.content, 'manager');
  const question = harness.enqueue({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-prompt', author: { id: 'u' }, content: 'ask' } });
  await new Promise<void>(resolve => setImmediate(resolve));
  assert.equal(harness.messages[8]?.payload.content, 'prompt-question');
  const answer = harness.enqueue({ op: 0, t: 'C2C_MESSAGE_CREATE', d: { id: 'package-answer', author: { id: 'u' }, content: 'plain input' } });
  assert.ok('done' in question && 'done' in answer);
  await Promise.all([question.done, answer.done]);
  assert.equal(harness.messages[9]?.payload.content, 'plain input');
  assert.equal(harness.messages[9]?.payload.msg_id, 'package-answer');
  assert.ok(import.meta.resolve('dd-bot').includes('consumer/node_modules/dd-bot/'));
} finally { await harness.app.close(); }
`,
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
const skillExamples = ['minimal-module.ts', 'minimal-module.test.ts'];
for (const name of skillExamples) {
  await writeFile(
    resolve(consumer, name),
    await readFile(resolve(root, 'skills', 'dd-bot', 'assets', name)),
  );
}
const program = ts.createProgram(
  [resolve(consumer, 'consumer.ts'), ...skillExamples.map((name) => resolve(consumer, name))],
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
await runNode(['--test', resolve(consumer, 'out', 'minimal-module.test.js')], { cwd: consumer });
console.log(`Package consumer passed; ${pack.files.length} allowed files, no credential matches.`);
