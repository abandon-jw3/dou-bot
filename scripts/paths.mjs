import { realpath, rm } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));

export async function removeBuildDirectory(name) {
  if (!['dist', '.test-build', 'coverage'].includes(name))
    throw new Error('Unknown build directory');
  const target = resolve(root, name);
  const resolvedRoot = await realpath(root);
  const actual = await realpath(target).catch((error) => {
    if (error.code === 'ENOENT') return target;
    throw error;
  });
  const within = relative(resolvedRoot, actual);
  if (!within || within.startsWith('..') || isAbsolute(within)) {
    throw new Error(`Refusing to remove path outside workspace: ${actual}`);
  }
  await rm(target, { recursive: true, force: true });
}

export function runNode(args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`Command failed (${code ?? signal}): node ${args.join(' ')}`));
    });
  });
}
