import { removeBuildDirectory, runNode } from './paths.mjs';
await removeBuildDirectory('dist');
await runNode(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.build.json']);
