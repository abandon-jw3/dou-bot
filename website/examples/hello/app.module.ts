import { HelpModule, Module } from 'dou-bot';
import { HelloController } from './hello.controller.js';
import { GREETING_SETTINGS, GreetingService } from './greeting.service.js';
import type { GreetingSettings } from './greeting.service.js';

@Module({
  imports: [HelpModule], // 显式启用 /help 和 /帮助。
  providers: [
    GreetingService,
    {
      provide: GREETING_SETTINGS,
      // useValue 注册一个现成的值；satisfies 只做类型检查；freeze 防止顶层属性被修改。
      useValue: Object.freeze({ salutation: '你好' } satisfies GreetingSettings),
    },
  ],
  controllers: [HelloController],
})
export class AppModule {}
