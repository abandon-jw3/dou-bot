import { Command, Controller, Ctx, Injectable, MessageSender, Module } from 'dou-bot';
import type { BotTarget, MessageContext } from 'dou-bot';

@Injectable()
export class Notifications {
  constructor(private readonly sender: MessageSender) {}

  // 外部 WS、定时任务传入业务保存的完整地址，不复用处理器的 Context。
  async send(target: BotTarget, text: string, signal?: AbortSignal): Promise<void> {
    await this.sender.sendMessage(target, text, signal ? { signal } : undefined);
  }
}

@Controller()
class AccountController {
  constructor(private readonly notifications: Notifications) {}

  @Command('account', { description: '查看当前机器人和会话' })
  account(@Ctx() ctx: MessageContext): string {
    return `机器人：${ctx.appId}；会话：${ctx.scene}`;
  }

  @Command('notify-here', { description: '由当前机器人主动发送到当前会话' })
  async notify(@Ctx() ctx: MessageContext): Promise<void> {
    // 主动发送仍受 QQ 权限和频控限制；普通命令回复优先 return 或 ctx.reply。
    await this.notifications.send(ctx.target, '通知已送达。', ctx.signal);
  }
}

@Module({ controllers: [AccountController], providers: [Notifications], exports: [Notifications] })
export class NotificationsModule {}
