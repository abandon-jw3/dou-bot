import { BotManager, Command, Controller, Ctx, Injectable, Module } from 'dou-bot';
import type { MessageContext } from 'dou-bot';

@Injectable()
export class ProfileService {
  constructor(private readonly bots: BotManager) {}

  async describe(appId: string, signal: AbortSignal): Promise<string> {
    const client = this.bots.get(appId).client;
    const highLevel = await client.getSelf({ signal });
    const lowLevel = await client.api.getSelf({ signal });
    return `高层客户端：${highLevel.id}；底层 API：${lowLevel.id}`;
  }
}
@Controller()
class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Command('bot-info')
  async info(@Ctx() ctx: MessageContext): Promise<string> {
    return this.profiles.describe(ctx.appId, ctx.signal);
  }
}
@Module({ providers: [ProfileService], controllers: [ProfileController] })
export class AppModule {}
