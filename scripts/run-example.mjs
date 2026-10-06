import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runNode, root } from './paths.mjs';
const name = process.argv[2];
if (
  ![
    'offline',
    'attachments',
    'identity',
    'query',
    'business',
    'business-qq',
    'qq',
    'diagnose',
    'live-probe',
    'live-media',
    'live-reconnect',
    'live-controls',
    'live-attachments',
    'benchmark',
    'soak',
  ].includes(name)
)
  throw new Error('Unknown example');
const output = resolve(root, 'work', 'runs', `${name}-${randomUUID()}`);
await runNode(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json', '--outDir', output]);
await runNode([
  ...(name === 'soak' ? ['--expose-gc'] : []),
  ...(['offline', 'attachments', 'identity', 'query', 'business', 'benchmark', 'soak'].includes(
    name,
  )
    ? []
    : [name === 'live-attachments' ? '--env-file=apps/example/.env' : '--env-file=.env']),
  resolve(output, 'examples', `${name}.js`),
  ...process.argv.slice(3),
]);
