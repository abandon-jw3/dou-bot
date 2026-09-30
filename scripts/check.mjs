import { runNode } from './paths.mjs';
const checks = [
  ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit'],
  ['node_modules/eslint/bin/eslint.js', 'src', 'tests', 'examples', '--max-warnings', '0'],
  [
    'node_modules/prettier/bin/prettier.cjs',
    '--check',
    'src',
    'tests',
    'examples',
    'scripts',
    'docs',
    'skills',
    '*.json',
    '*.mjs',
    '*.md',
    '.github',
  ],
  ['scripts/check-docs.mjs'],
  ['scripts/build.mjs'],
  ['scripts/compile-tests.mjs'],
  ['--test', '.test-build/tests/**/*.test.js'],
  ['scripts/test-package.mjs'],
];
for (const args of checks) await runNode(args);
