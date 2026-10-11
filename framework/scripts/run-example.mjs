import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runNode, root, repositoryRoot } from './paths.mjs';
const name = process.argv[2];
if (
  ![
    'offline',
    'attachments',
    'identity',
    'context',
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
    'benchmark-framework',
    'capacity',
    'soak',
  ].includes(name)
)
  throw new Error('Unknown example');
const output = resolve(root, 'work', 'runs', `${name}-${randomUUID()}`);
await runNode(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json', '--outDir', output]);
await runNode([
  ...(['soak', 'benchmark', 'benchmark-framework', 'capacity'].includes(name)
    ? ['--expose-gc']
    : []),
  ...([
    'offline',
    'attachments',
    'identity',
    'context',
    'query',
    'business',
    'benchmark',
    'benchmark-framework',
    'capacity',
    'soak',
  ].includes(name)
    ? []
    : [
        `--env-file=${name === 'live-attachments' ? resolve(repositoryRoot, 'example/.env') : resolve(root, '.env')}`,
      ]),
  resolve(output, 'examples', `${name}.js`),
  ...process.argv.slice(3),
]);
