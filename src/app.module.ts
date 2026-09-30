import { Module } from 'dou-bot';
import { BotController } from './bot.controller.js';
import { ExampleModule } from './example/example.module.js';

// ExampleModule 集中演示全部装饰器；移除这个导入和 imports 项即可只保留 hello。
@Module({ imports: [ExampleModule], controllers: [BotController] })
export class AppModule {}
