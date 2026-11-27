import assert from 'node:assert/strict';
import test from 'node:test';
import {
  Arg,
  Command,
  ContextValue,
  Controller,
  createContextKey,
  Ctx,
  GroupOnly,
  Injectable,
  markdown,
  Module,
  OnButton,
  Route,
  Slot,
} from '../src/index.js';
import type { ContextMiddleware, GroupButtonContext, MiddlewareContext } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

class BusinessError extends Error {}
class AppSettings {
  constructor(readonly tag: string) {}
}
const SCOPE = createContextKey<string>('scope');

await test('v1.1: button passive reply, pattern/multi routes, @Route, Slot-before-Arg, global modules, app providers/middlewares, and onHandlerError', async (t) => {
  @Injectable()
  class SharedService {
    constructor(readonly settings: AppSettings) {}
  }

  @Module({ global: true, providers: [SharedService], exports: [SharedService] })
  class GlobalInfraModule {}

  @Injectable()
  class GlobalMiddleware implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      ctx.state.set(SCOPE, `${ctx.appId}:${ctx.userId}`);
    }
  }

  @Controller()
  @GroupOnly()
  class FeatureController {
    constructor(private readonly shared: SharedService) {}

    @Command(['本周战功', '上周战功'], { description: '战功榜' })
    merit(
      @Route() route: string,
      @Slot('server', { choices: ['梦江南', '唯满侠'] }) server: string | undefined,
      @Arg(0, { name: '角色名' }) name: string | undefined,
      @Arg(1, { name: '页码', type: 'integer', min: 1, default: 1 }) page: number,
      @ContextValue(SCOPE) scope: string,
    ): string {
      return `${this.shared.settings.tag}|${route}|${server ?? '-'}|${name ?? '-'}|${page}|${scope}`;
    }

    @Command('报错')
    fail(@Arg(0) kind?: string): string {
      if (kind === 'biz') throw new BusinessError('业务提示');
      throw new Error('secret internal crash');
    }

    @OnButton(/^dps-/)
    dps(@Route() buttonId: string, @Ctx() ctx: GroupButtonContext) {
      return markdown(`点击:${buttonId}:${ctx.data}`);
    }
  }

  @Module({
    imports: [GlobalInfraModule],
    controllers: [FeatureController],
    providers: [GlobalMiddleware],
  })
  class AppModule {}

  const bot = await createTestApplication(AppModule, {
    commands: { prefix: '', invalidInput: 'reply' },
    providers: [{ provide: AppSettings, useValue: new AppSettings('v11') }],
    middlewares: [GlobalMiddleware],
    onHandlerError: (error) => {
      if (error instanceof BusinessError) return { reply: error.message, report: false };
      return { reply: '查询失败，请稍后重试。', report: true };
    },
  });
  t.after(() => bot.app.close());
  await bot.app.start();

  // Slot matched before positional @Arg: unordered server + name + page both bind identically.
  await bot.dispatch({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'm1',
      group_openid: 'g1',
      author: { member_openid: 'u1' },
      content: '本周战功 小明 梦江南 2',
    },
  });
  await bot.dispatch({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'm2',
      group_openid: 'g1',
      author: { member_openid: 'u1' },
      content: '上周战功 梦江南 小明 3',
    },
  });
  assert.equal(bot.messages[0]?.payload.content, 'v11|本周战功|梦江南|小明|2|offline-app:u1');
  assert.equal(bot.messages[1]?.payload.content, 'v11|上周战功|梦江南|小明|3|offline-app:u1');

  // onHandlerError: BusinessError replies silently without reporting; technical error replies and reports.
  await bot.dispatch({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id: 'm3', group_openid: 'g1', author: { member_openid: 'u1' }, content: '报错 biz' },
  });
  assert.equal(bot.messages[2]?.payload.content, '业务提示');
  assert.equal(bot.errors.length, 0);

  await bot.dispatch({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: { id: 'm4', group_openid: 'g1', author: { member_openid: 'u1' }, content: '报错 tech' },
  });
  assert.equal(bot.messages[3]?.payload.content, '查询失败，请稍后重试。');
  assert.equal(bot.errors.length, 1);

  // @OnButton RegExp route + automatic passive reply with event_id.
  await bot.dispatch({
    op: 0,
    t: 'INTERACTION_CREATE',
    id: 'INTERACTION_CREATE:evt-42',
    d: {
      id: 'int-1',
      chat_type: 1,
      group_openid: 'g1',
      group_member_openid: 'u1',
      data: { resolved: { button_id: 'dps-3', button_data: 'set=1' } },
    },
  });
  assert.equal(bot.messages[4]?.payload.event_id, 'INTERACTION_CREATE:evt-42');
  assert.equal(bot.messages[4]?.payload.msg_type, 2);
  assert.equal(bot.messages[4]?.payload.markdown?.content, '点击:dps-3:set=1');
  assert.equal(bot.errors.length, 1);
});
