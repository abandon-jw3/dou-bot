import { Command, Controller, UseGuards } from 'dou-bot';
import { PrivateOnlyGuard } from './example.guard.ts';

// @UseGuards 也可以写在类上，保护此类的所有 Command 和 OnButton。
// 类级 Guard 先于方法级 Guard；它不会应用到原始 On 观察器。
// 将这个控制器单独注册，便于对照 example-group 的方法级写法。
@Controller()
@UseGuards(PrivateOnlyGuard)
export class ExamplePrivateController {
  @Command('example-private', { description: '类级 Guard：只允许私聊' })
  privateOnly(): string {
    return '类级 Guard 已放行：当前是私聊。';
  }
}
