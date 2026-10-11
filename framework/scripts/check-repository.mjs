import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { root, repositoryRoot, runNode } from './paths.mjs';
import { checkDocumentLinks } from './document-links.mjs';

const manifest = JSON.parse(await readFile(resolve(repositoryRoot, 'package.json'), 'utf8'));
assert.equal(manifest.name, 'dou-bot-repository');
assert.equal(manifest.private, true);
for (const key of [
  'dependencies',
  'devDependencies',
  'workspaces',
  'exports',
  'main',
  'types',
  'publishConfig',
])
  assert.equal(key in manifest, false, `Repository root must not own ${key}`);
assert.deepEqual(
  Object.keys(manifest.scripts).sort(),
  [
    'install:all',
    'check:all',
    'example:check',
    'example:build',
    'example:start',
    'example:dev',
    'docs:dev',
    'docs:build',
    'docs:check',
    'docs:test:browser',
  ].sort(),
);
for (const old of [
  'apps',
  'src',
  'tests',
  'examples',
  'scripts',
  'docs',
  'skills',
  'package-lock.json',
]) {
  const exists = await access(resolve(repositoryRoot, old)).then(
    () => true,
    (error) => {
      if (error.code === 'ENOENT') return false;
      throw error;
    },
  );
  assert.equal(exists, false, `Obsolete repository-root path: ${old}`);
}
const packages = await Promise.all(
  ['framework', 'example', 'website'].map(async (name) => {
    const path = resolve(repositoryRoot, name);
    await access(resolve(path, 'package-lock.json'));
    const pkg = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8'));
    assert.equal(pkg.workspaces, undefined);
    return pkg;
  }),
);
assert.equal(packages[0].name, 'dou-bot');
assert.equal(packages[0].repository.directory, 'framework');
assert.equal(packages[1].private, true);
assert.equal(packages[2].private, true);
for (const name of ['LICENSE', 'NOTICE'])
  assert.equal(
    await readFile(resolve(root, name), 'utf8'),
    await readFile(resolve(repositoryRoot, name), 'utf8'),
  );
const readme = resolve(repositoryRoot, 'README.md');
const links = await checkDocumentLinks(readme, await readFile(readme, 'utf8'));
await runNode(
  [
    resolve(root, 'node_modules/prettier/bin/prettier.cjs'),
    '--check',
    'README.md',
    'package.json',
    '.prettierrc.json',
    '.github',
  ],
  { cwd: repositoryRoot },
);
console.log(`Repository layout, package boundaries and ${links} root document links verified.`);
