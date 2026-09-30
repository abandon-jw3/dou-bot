import { Command, Controller, Ctx, Injectable, Module, QQApi, QQClient } from 'dou-bot';
import type { MessageContext } from 'dou-bot';

@Injectable()
export class ProfileService {
  // 使用值导入；这两个内置令牌由框架提供，不放入 providers 再覆盖。
  constructor(
    private readonly client: QQClient,
    private readonly api: QQApi,
  ) {}
  async describe(signal: AbortSignal): Promise<string> {
    const highLevel = await this.client.getSelf({ signal });
    const lowLevel = await this.api.getSelf({ signal });
    return `高层客户端：${highLevel.id}；底层 API：${lowLevel.id}`;
  }
}
@Controller()
class ProfileController {
  constructor(private readonly profiles: ProfileService) {}
  @Command('bot-info')
  async info(@Ctx() ctx: MessageContext): Promise<string> {
    return this.profiles.describe(ctx.signal);
  }
}
@Module({ providers: [ProfileService], controllers: [ProfileController] })
export class AppModule {}
