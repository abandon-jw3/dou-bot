import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(resolve(root, 'vendor/sdk.json'), 'utf8'));
const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const locked = lock.packages?.['node_modules/dou-bot'];
assert.ok(['source', 'registry'].includes(metadata.channel));
assert.equal(metadata.package, 'dou-bot');
assert.equal(
  project.dependencies?.['dou-bot'] ?? project.devDependencies?.['dou-bot'],
  metadata.dependency,
);
assert.equal(locked?.version, metadata.version);
assert.equal(
  locked?.resolved,
  metadata.channel === 'source' ? metadata.dependency : metadata.tarball,
);
assert.equal(locked?.integrity, metadata.integrity);
assert.notEqual(locked?.link, true);
if (metadata.channel === 'source') {
  const bytes = await readFile(resolve(root, 'vendor/dou-bot-source.tgz'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), metadata.sha256);
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, metadata.integrity);
} else {
  assert.equal(metadata.dependency, metadata.version);
  assert.equal(metadata.registry, 'https://registry.npmjs.org/');
  assert.equal(
    metadata.tarball,
    `https://registry.npmjs.org/dou-bot/-/dou-bot-${metadata.version}.tgz`,
  );
}
const sdkRoot = resolve(root, 'node_modules/dou-bot');
const installed = JSON.parse(await readFile(resolve(sdkRoot, 'package.json'), 'utf8'));
assert.equal(installed.name, metadata.package);
assert.equal(installed.version, metadata.version);
const entry = await realpath(fileURLToPath(import.meta.resolve('dou-bot')));
const local = relative(sdkRoot, entry);
assert.ok(local && !local.startsWith('..') && !isAbsolute(local), 'SDK must use this installation');
async function files(dir) {
  const result = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) result.push(...(await files(path)));
    else if (item.isFile()) result.push(path);
  }
  return result.sort((left, right) => {
    const a = left.replaceAll('\\', '/');
    const b = right.replaceAll('\\', '/');
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
const hash = createHash('sha256');
for (const file of await files(resolve(sdkRoot, 'dist'))) {
  hash.update(relative(sdkRoot, file).replaceAll('\\', '/')).update('\0');
  hash.update(await readFile(file)).update('\0');
}
assert.equal(
  hash.digest('hex'),
  metadata.distSha256,
  'Installed SDK content must match the snapshot',
);
console.log(
  `${metadata.channel === 'registry' ? 'Published' : 'Source'} SDK, lock integrity and independent installation verified.`,
);
