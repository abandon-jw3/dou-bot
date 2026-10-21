import { createHash } from 'node:crypto';
import { access, mkdir, readFile, readdir, realpath, copyFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, repositoryRoot, runNode } from './paths.mjs';

// 用户入口安装同一份独立 tarball；不会链接 framework/src 或改变发行版本。
await runNode(['scripts/build.mjs']);
const output = resolve(root, 'work/user-sdk');
await mkdir(output, { recursive: true });
const executable = await realpath(process.execPath);
let npmCli;
for (const candidate of [
  process.env.npm_execpath,
  resolve(dirname(executable), 'node_modules/npm/bin/npm-cli.js'),
  resolve(dirname(executable), '../lib/node_modules/npm/bin/npm-cli.js'),
]) {
  if (!candidate?.endsWith('npm-cli.js')) continue;
  if (
    await access(candidate).then(
      () => true,
      () => false,
    )
  ) {
    npmCli = candidate;
    break;
  }
}
if (!npmCli) throw new Error('Cannot locate npm CLI; run through npm exec.');
const packed = spawnSync(
  process.execPath,
  [npmCli, 'pack', '--ignore-scripts', '--json', '--pack-destination', output],
  {
    cwd: root,
    encoding: 'utf8',
  },
);
if (packed.status !== 0) throw new Error(packed.stderr || 'npm pack failed');
const [record] = JSON.parse(packed.stdout);
const tarball = resolve(output, record.filename);
const bytes = await readFile(tarball);
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) result.push(...(await files(path)));
    else if (entry.isFile()) result.push(path);
  }
  return result.sort((left, right) => {
    const a = left.replaceAll('\\', '/');
    const b = right.replaceAll('\\', '/');
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
const distHash = createHash('sha256');
for (const file of await files(resolve(root, 'dist'))) {
  distHash.update(relative(root, file).replaceAll('\\', '/')).update('\0');
  distHash.update(await readFile(file)).update('\0');
}
const metadata = {
  package: 'dou-bot',
  channel: 'source',
  contract: '2.0',
  version: record.version,
  dependency: 'file:vendor/dou-bot-source.tgz',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  distSha256: distHash.digest('hex'),
};
for (const project of ['example', 'website']) {
  const vendor = resolve(repositoryRoot, project, 'vendor');
  await mkdir(vendor, { recursive: true });
  await copyFile(tarball, resolve(vendor, 'dou-bot-source.tgz'));
  await writeFile(resolve(vendor, 'sdk.json'), JSON.stringify(metadata, null, 2) + '\n');
}
console.log(
  'Source SDK snapshots prepared. Reinstall ./vendor/dou-bot-source.tgz in both projects to update lockfiles (website: --save-dev).',
);
