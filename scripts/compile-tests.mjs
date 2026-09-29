import { removeBuildDirectory, runNode } from './paths.mjs';
await removeBuildDirectory('.test-build');
await runNode(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']);
