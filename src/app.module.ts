import { Module } from 'dd-bot';
import { BotController } from './bot.controller.js';

@Module({ controllers: [BotController] })
export class AppModule {}
