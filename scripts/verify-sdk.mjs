import { readFile, realpath, readdir } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(await readFile(resolve(root, 'vendor/sdk.json'), 'utf8'));
const bytes = await readFile(resolve(root, 'vendor', metadata.file));
if (createHash('sha256').update(bytes).digest('hex') !== metadata.sha256)
  throw new Error('SDK archive hash mismatch');
const entry = await realpath(fileURLToPath(import.meta.resolve('dd-bot')));
const local = relative(resolve(root, 'node_modules/dd-bot'), entry);
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
          /from\s+['"]dd-bot\/(?!testing['"])/u.test(content) ||
          /from\s+['"][^'"]*\.\.\/dd-bot\//u.test(content)
        )
          throw new Error('Business code must use public SDK imports');
      }
    }
  }
  await inspect(resolve(root, directory));
}
console.log('SDK archive integrity and independent public imports verified.');
