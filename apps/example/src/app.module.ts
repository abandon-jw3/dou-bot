import { Module } from 'dou-bot';
import { BotController } from './bot.controller.ts';
import { ExampleModule } from './example/example.module.ts';

// ExampleModule 集中演示全部装饰器；移除这个导入和 imports 项即可只保留 hello。
@Module({ imports: [ExampleModule], controllers: [BotController] })
export class AppModule {}
