import { Controller, Ctx, On } from 'dou-bot';
import type { QQEventContext } from 'dou-bot';
import { ExampleService } from './example.service.ts';

@Controller()
export class ExampleEventsController {
  constructor(private readonly examples: ExampleService) {}

  // @On 精确监听 QQ 原始事件名，而不是通用的 "message" 事件。
  // 观察器只接受 @Ctx，返回 void；不能添加命令参数、Guard 或 Cooldown。
  // QQEventContext 可读 eventName/raw/signal，但没有消息上下文的 reply。
  // 已被 prompt 接管的回答不会再次进入这些观察器。
  @On('C2C_MESSAGE_CREATE')
  privateMessage(@Ctx() ctx: QQEventContext): void {
    this.examples.recordMessage(ctx.eventName);
  }

  // 群聊 @机器人消息使用此事件；每个方法只声明一个 On 路由。
  @On('GROUP_AT_MESSAGE_CREATE')
  groupMention(@Ctx() ctx: QQEventContext): void {
    this.examples.recordMessage(ctx.eventName);
  }

  // 群聊普通消息使用此事件，前提是 QQ 向当前机器人投递了消息。
  // 这里只计数，不回复普通聊天，也不拦截后续命令执行。
  @On('GROUP_MESSAGE_CREATE')
  groupMessage(@Ctx() ctx: QQEventContext): void {
    this.examples.recordMessage(ctx.eventName);
  }
}
