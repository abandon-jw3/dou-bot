import { rm, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(root, '.examples-build');
const actual = await realpath(output).catch((error) => {
  if (error.code === 'ENOENT') return output;
  throw error;
});
const within = relative(await realpath(root), actual);
if (!within || within.startsWith('..') || isAbsolute(within))
  throw new Error('Build directory escaped the project');
await rm(output, { recursive: true, force: true });
await new Promise((yes, no) => {
  const child = spawn(
    process.execPath,
    [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.examples.json'],
    { cwd: root, stdio: 'inherit' },
  );
  child.once('error', no);
  child.once('exit', (code) =>
    code === 0 ? yes() : no(new Error(`Example compilation failed: ${code}`)),
  );
});
