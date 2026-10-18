import { runNode } from './paths.mjs';
for (const key of ['HOST', 'USER', 'NAME']) {
  if (!process.env[`TEST_DATABASE_${key}`])
    throw new Error(
      `Configure dedicated TEST_DATABASE_${key}; business database settings are never used.`,
    );
}
process.env.DOUBOT_REQUIRE_TEST_DATABASE = '1';
await runNode(['scripts/compile-tests.mjs']);
await runNode(['--test', '.test-build/tests/postgres.test.js']);
