import {
  Command,
  Controller,
  Cooldown,
  HelpModule,
  Inject,
  Injectable,
  Module,
  Option,
  Rest,
  Slot,
  UseGuards,
} from 'dou-bot';
import type { Awaitable, CanActivate, GuardContext, GuardResult, Type } from 'dou-bot';

export type QueryPolicy = (context: GuardContext) => Awaitable<GuardResult>;
const POLICY = Symbol('query-policy');
const cityWords = new Set(['北京', '上海']);

// This small dictionary belongs to the example business, not to the SDK.
export function City(): ParameterDecorator {
  return Slot('city', {
    name: '城市',
    required: true,
    match: (text) => cityWords.has(text),
  });
}

@Injectable()
class QueryGuard implements CanActivate {
  constructor(@Inject(POLICY) private readonly policy: QueryPolicy) {}
  canActivate(ctx: GuardContext): Awaitable<GuardResult> {
    return this.policy(ctx);
  }
}

@Injectable()
class QueryService {
  // Demonstrates argument binding only. Replace with the requested real business service.
  describe(
    city: string,
    topic: string,
    remaining: readonly string[],
    page: number,
    detail: boolean,
  ): string {
    return JSON.stringify({ city, topic, remaining, page, detail });
  }
}

@Controller()
@UseGuards(QueryGuard)
class QueryController {
  constructor(private readonly queries: QueryService) {}

  @Command('查询', {
    aliases: ['查'],
    description: '展示参数解析，业务数据源由应用接入',
  })
  @Cooldown({ scope: 'user', durationMs: 3000, message: '请稍后再查询。' })
  query(
    @Rest({ name: '补充内容' }) remaining: string[],
    @City() city: string,
    @Slot('topic', {
      name: '查询类型',
      required: true,
      choices: ['天气', '空气质量'],
    })
    topic: string,
    @Option('page', {
      alias: 'p',
      name: '页码',
      type: 'integer',
      min: 1,
      default: 1,
    })
    page: number,
    @Option('detail', { alias: 'd', type: 'boolean', default: false })
    detail: boolean,
  ): string {
    return this.queries.describe(city, topic, remaining, page, detail);
  }
}

export function createQueryModule(policy: QueryPolicy): Type {
  @Module({
    imports: [HelpModule],
    providers: [{ provide: POLICY, useValue: policy }, QueryGuard, QueryService],
    controllers: [QueryController],
  })
  class QueryModule {}
  return QueryModule;
}
