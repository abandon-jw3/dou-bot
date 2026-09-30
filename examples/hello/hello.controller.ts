import { Arg, Command, Controller } from 'dou-bot';
// 构造注入需要运行时类，不能把这个导入改成 import type。
import { GreetingService } from './greeting.service.js';

@Controller()
export class HelloController {
  constructor(private readonly greetings: GreetingService) {}
  @Command('hello', { aliases: ['hi'], description: '向你问好' })
  hello(@Arg(0) name = '朋友'): string {
    // 返回字符串由框架自动回复；这里不用再手动 ctx.reply。
    return this.greetings.hello(name);
  }
}
