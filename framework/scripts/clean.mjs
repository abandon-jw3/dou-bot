import { removeBuildDirectory } from './paths.mjs';
for (const directory of ['dist', '.test-build', 'coverage']) await removeBuildDirectory(directory);
