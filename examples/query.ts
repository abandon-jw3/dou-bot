import { Command, Controller, HelpModule, Module, Option, Rest, Slot } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

const cities = new Set(['北京', '上海', '深圳']);

@Controller()
class QueryController {
  @Command('查询', { aliases: ['查'], description: '演示无序参数、剩余参数和选项' })
  query(
    @Slot('city', { name: '城市', required: true, match: (text) => cities.has(text) })
    city: string,

    @Slot('topic', { name: '查询类型', required: true, choices: ['天气', '空气质量'] })
    topic: string,

    @Rest({ name: '补充内容' })
    remaining: string[],

    @Option('page', { alias: 'p', name: '页码', type: 'integer', min: 1, default: 1 })
    page: number,

    @Option('detail', { alias: 'd', name: '详细模式', type: 'boolean', default: false })
    detail: boolean,
  ): string {
    // Replace this demonstration response with a call to an injected business service.
    return [
      `城市：${city}；类型：${topic}`,
      `补充内容：${JSON.stringify(remaining)}`,
      `页码：${page}；详细：${detail}`,
    ].join('\n');
  }
}

@Module({ imports: [HelpModule], controllers: [QueryController] })
class AppModule {}

// Offline: does not load .env or send QQ messages. Both transports use this same dispatcher.
const harness = await createTestApplication(AppModule, {
  commands: { prefix: '', invalidInput: 'reply' },
});
try {
  await harness.app.start();
  const inputs = [
    '查询 北京 天气',
    '查询 天气 北京',
    '查询 今天 天气 北京 详细',
    '查 北京 空气质量 "未来 三天" --page 2 -d',
    '查询 北京 上海 天气',
    '帮助 查询',
  ];
  for (const [index, content] of inputs.entries()) {
    await harness.dispatch({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id: `query-example-${index}`, author: { user_openid: 'offline-user' }, content },
    });
    console.log(`> ${content}\n${harness.messages.at(-1)?.payload.content ?? '没有回复'}\n`);
  }
} finally {
  await harness.app.close();
}
