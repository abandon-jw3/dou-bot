import { Command, Controller, Ctx, Inject, Injectable, LOGGER, Module, On } from 'dou-bot';
import type { Logger, QQEventContext } from 'dou-bot';

@Injectable()
export class EventCounter {
  count = 0;
}
@Controller()
class EventsController {
  constructor(
    private readonly counter: EventCounter,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}
  @On('C2C_MESSAGE_CREATE')
  privateEvent(@Ctx() ctx: QQEventContext): void {
    this.record(ctx);
  }
  @On('GROUP_MESSAGE_CREATE')
  groupEvent(@Ctx() ctx: QQEventContext): void {
    this.record(ctx);
  }
  @On('GROUP_AT_MESSAGE_CREATE')
  mentionEvent(@Ctx() ctx: QQEventContext): void {
    this.record(ctx);
  }
  private record(ctx: QQEventContext): void {
    this.counter.count++;
    this.logger.debug('收到事件', { eventName: ctx.eventName }); // 不记录正文或身份标识。
  }
  @Command('events') count(): string {
    return `观察到 ${this.counter.count} 条消息事件。`;
  }
  // On 必须返回 void；它独立于命令 Guard，不适合直接承担受保护的业务入口。
}
@Module({ providers: [EventCounter], controllers: [EventsController] })
export class AppModule {}
