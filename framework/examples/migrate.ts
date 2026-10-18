import { migrateDatabase } from '../src/index.js';
import { exampleDatabase } from './live-application.js';
await migrateDatabase(exampleDatabase());
console.log('Framework PostgreSQL schema is ready. No QQ connection was started.');
