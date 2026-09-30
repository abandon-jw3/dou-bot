import { readFile, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(resolve(root, 'vendor/sdk.json'), 'utf8'));
if (metadata.package !== 'dou-bot') throw new Error('Unexpected SDK package name');
const project = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
const locked = lock.packages?.['node_modules/dou-bot'];
if (
  project.dependencies?.['dou-bot'] !== metadata.version ||
  locked?.version !== metadata.version ||
  locked?.resolved !== metadata.tarball ||
  locked?.integrity !== metadata.integrity
)
  throw new Error('SDK dependency and lockfile must match the recorded npm release');
const sdkRoot = resolve(root, 'node_modules/dou-bot');
const installed = JSON.parse(await readFile(resolve(sdkRoot, 'package.json'), 'utf8'));
if (installed.name !== metadata.package || installed.version !== metadata.version)
  throw new Error('Installed SDK does not match the recorded package and version');
const entry = await realpath(fileURLToPath(import.meta.resolve('dou-bot')));
const local = relative(sdkRoot, entry);
if (!local || local.startsWith('..') || isAbsolute(local))
  throw new Error('SDK must resolve within this installation');
for (const directory of ['src', 'tests']) {
  async function inspect(path) {
    for (const item of await readdir(path, { withFileTypes: true })) {
      const file = resolve(path, item.name);
      if (item.isDirectory()) await inspect(file);
      else if (file.endsWith('.ts')) {
        const content = await readFile(file, 'utf8');
        if (
          /from\s+['"]dd-bot(?:['"]|\/)/u.test(content) ||
          /from\s+['"]dou-bot\/(?!testing['"])/u.test(content) ||
          /from\s+['"][^'"]*\.\.\/dd-bot\//u.test(content)
        )
          throw new Error(`Business code must use public SDK imports: ${relative(root, file)}`);
      }
    }
  }
  await inspect(resolve(root, directory));
}
console.log('Published SDK lock integrity and independent public imports verified.');
