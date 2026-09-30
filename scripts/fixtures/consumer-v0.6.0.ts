// Historical 0.6.0 consumer. Keep existing calls and assertions when evolving the SDK.
import assert from 'node:assert/strict';
import {
  Arg,
  Command,
  Controller,
  Cooldown,
  Ctx,
  GroupManagersOnly,
  HelpModule,
  Injectable,
  Module,
  Option,
  Rest,
  Slot,
  UseGuards,
} from 'dou-bot';
import type { CanActivate, GuardContext, GuardResult, MessageContext } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';
@Injectable()
class Greeter {
  hello(name: string) {
    return 'Hello ' + name;
  }
}
@Injectable()
class ModuleGate implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.userId !== 'module-blocked' || { allow: false, message: 'module denied' };
  }
}
@Injectable()
class Guard implements CanActivate {
  canActivate(ctx: GuardContext): GuardResult {
    return ctx.userId === 'u' || { allow: false, message: 'blocked' };
  }
}
@Controller()
class Commands {
  constructor(private readonly service: Greeter) {}
  @Command('hello') hello(@Arg(0) name: string) {
    return this.service.hello(name);
  }
  @UseGuards(Guard)
  @Cooldown({ scope: 'user', durationMs: 60000, message: 'wait' })
  @Command('controlled')
  controlled() {
    return 'allowed';
  }
  @Command('manage') @GroupManagersOnly() manage() {
    return 'manager';
  }
  @Command('ask') async ask(@Ctx() ctx: MessageContext): Promise<void> {
    const answer = await ctx.prompt('prompt-question');
    if (answer.status === 'received') await answer.message.reply(answer.message.content);
  }
  @Command('query') query(
    @Rest() rest: string[],
    @Slot('city', { choices: ['北京'], required: true }) city: string,
    @Slot('topic', { choices: ['天气'], required: true }) topic: string,
    @Option('page', { type: 'integer', alias: 'p', min: 1, default: 1 }) page: number,
  ) {
    return JSON.stringify({ city, topic, page, rest });
  }
}
@Module({
  imports: [HelpModule],
  providers: [Greeter, Guard, ModuleGate],
  guards: [ModuleGate],
  controllers: [Commands],
})
class Root {}
const harness = await createTestApplication(Root, {
  commands: { prefix: '', invalidInput: 'reply' },
});
await harness.app.start();
try {
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-test', author: { id: 'u' }, content: 'hello package' },
  });
  assert.equal(harness.messages[0]?.payload.content, 'Hello package');
  assert.equal(harness.errors.length, 0);
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-query', author: { id: 'u' }, content: 'query 今天 天气 北京 -p 2' },
  });
  assert.deepEqual(JSON.parse(harness.messages[1]!.payload.content!), {
    city: '北京',
    topic: '天气',
    page: 2,
    rest: ['今天'],
  });
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-help', author: { id: 'u' }, content: 'help query' },
  });
  assert.match(harness.messages[2]!.payload.content!, /用法：query/);
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-error', author: { id: 'u' }, content: 'query 北京' },
  });
  assert.match(harness.messages[3]!.payload.content!, /缺少必填参数/);
  for (const [id, user] of [
    ['deny', 'other'],
    ['allow', 'u'],
    ['cooldown', 'u'],
  ])
    await harness.dispatch({
      op: 0,
      t: 'C2C_MESSAGE_CREATE',
      d: { id, author: { id: user }, content: 'controlled' },
    });
  assert.deepEqual(
    harness.messages.slice(4).map((m) => m.payload.content),
    ['blocked', 'allowed', 'wait'],
  );
  await harness.dispatch({
    op: 0,
    t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'package-manager',
      group_openid: 'g',
      author: { member_openid: 'u', member_role: 'owner' },
      content: 'manage',
    },
  });
  assert.equal(harness.messages[7]?.payload.content, 'manager');
  const question = harness.enqueue({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-prompt', author: { id: 'u' }, content: 'ask' },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(harness.messages[8]?.payload.content, 'prompt-question');
  const answer = harness.enqueue({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-answer', author: { id: 'u' }, content: 'plain input' },
  });
  assert.ok('done' in question && 'done' in answer);
  await Promise.all([question.done, answer.done]);
  assert.equal(harness.messages[9]?.payload.content, 'plain input');
  assert.equal(harness.messages[9]?.payload.msg_id, 'package-answer');
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'package-module-guard', author: { id: 'module-blocked' }, content: 'hello blocked' },
  });
  assert.equal(harness.messages[10]?.payload.content, 'module denied');
  assert.ok(import.meta.resolve('dou-bot').includes('consumer/node_modules/dou-bot/'));
} finally {
  await harness.app.close();
}
