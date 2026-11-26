import { migrateDatabase } from 'dou-bot';
import { databaseOptions } from './config.ts';

await migrateDatabase(databaseOptions(process.env));
