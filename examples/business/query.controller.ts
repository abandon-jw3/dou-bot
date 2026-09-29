import {
  Command,
  Controller,
  Cooldown,
  Ctx,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
  button,
  keyboard,
  markdown,
} from '../../src/index.js';
import type { ButtonContext, MarkdownMessage } from '../../src/index.js';
import { City } from './city.decorator.js';
import { QueryPermissionGuard } from './query-permission.guard.js';
import { QueryService } from './query.service.js';
import type { Topic } from './query.service.js';

@Controller()
@UseGuards(QueryPermissionGuard)
export class QueryController {
  constructor(private readonly queries: QueryService) {}

  @Command('查询', { aliases: ['查'], description: '演示城市查询，需要业务白名单权限' })
  @Cooldown({ scope: 'user', durationMs: 3000 })
  query(
    @City() city: string,
    @Slot('topic', { name: '查询类型', required: true, choices: ['天气', '空气质量'] })
    topic: Topic,
    @Rest({ name: '补充内容' }) remaining: string[],
    @Option('detail', { alias: 'd', name: '详细模式', type: 'boolean', default: false })
    detail: boolean,
  ): MarkdownMessage {
    return markdown(this.queries.query(city, topic, remaining, detail), {
      keyboard: keyboard([[button.callback('query-weather', '刷新天气', city)]]),
    });
  }

  @OnButton('query-weather')
  @Cooldown({ scope: 'user', durationMs: 3000, message: '刷新太快，请稍后再试。' })
  async refresh(@Ctx() ctx: ButtonContext): Promise<void> {
    await ctx.ack();
    await ctx.send(this.queries.query(ctx.data, '天气', [], false));
  }
}
