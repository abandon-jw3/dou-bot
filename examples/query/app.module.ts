import { Arg, Args, Command, Controller, HelpModule, Module, Option, Rest, Slot } from 'dou-bot';
import { City } from './city.decorator.js';

@Controller()
export class QueryController {
  @Command('查询', { aliases: ['查'], description: '演示无序参数解析，不查询实时天气' })
  query(
    @City() city: string,
    @Slot('topic', { name: '主题', choices: ['天气', '空气质量'], required: true }) topic: string,
    // Rest 收集未被位置参数、Slot 和 Option 消费的普通分词，保留顺序。
    @Rest({ name: '备注' }) notes: string[],
    @Option('page', { alias: 'p', type: 'integer', min: 1, default: 1 }) page: number,
    @Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean,
  ): string {
    return JSON.stringify({ city, topic, notes, page, detail });
  }

  @Command('echo', { description: '查看完整分词' })
  echo(@Args() words: string[]): string {
    return JSON.stringify(words);
  }

  @Command('repeat', { description: '演示显式数值转换' })
  repeat(
    @Arg(0, { required: true }) word: string,
    @Arg(1, { type: 'integer', min: 1, max: 5, default: 1 }) count: number,
  ): string {
    // 仅声明 TypeScript 的 number 不会转换输入，转换由 type: integer 指定。
    return Array.from({ length: count }, () => word).join(' ');
  }
}
@Module({ imports: [HelpModule], controllers: [QueryController] })
export class AppModule {}
