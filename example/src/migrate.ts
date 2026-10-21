import { migrateDatabase } from 'dou-bot';
import { databaseOptions } from './config.ts';

// 显式初始化框架表，普通启动与保存后重启不运行迁移。
await migrateDatabase(databaseOptions(process.env));
console.log('数据库结构已就绪。');
