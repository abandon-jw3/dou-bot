import assert from 'node:assert/strict';
import { Args, Command, Controller, Module, Slot } from 'dou-bot';
import type { SlotOptions } from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

const aliases = new Map([
  ['梦江南', '梦江南'],
  ['双梦', '梦江南'],
]);
const options: SlotOptions = {
  name: '服务器',
  match: (text) => aliases.has(text),
  normalize: (text) => aliases.get(text)!,
};
function Server(): ParameterDecorator {
  return Slot('server', { ...options, required: true });
}

@Controller()
class Status {
  @Command('状态') status(@Server() server: string, @Args() args: string[]): string {
    return JSON.stringify({ server, args });
  }
  @Command('默认状态') fallback(
    @Slot('server', { ...options, default: '双梦' }) server: string,
  ): string {
    return server;
  }
}
@Module({ controllers: [Status] })
class Root {}
const harness = await createTestApplication(Root, { commands: { prefix: '' } });
await harness.app.start();
let id = 0;
try {
  for (const group of [false, true]) {
    for (const alias of aliases.keys()) {
      await harness.dispatch({
        op: 0,
        t: group ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
        d: {
          id: `slot-consumer-${++id}`,
          ...(group
            ? { group_openid: 'group', author: { member_openid: 'user' } }
            : { author: { user_openid: 'user' } }),
          content: `状态 ${alias}`,
        },
      });
      assert.deepEqual(JSON.parse(harness.messages.at(-1)!.payload.content!), {
        server: '梦江南',
        args: [alias],
      });
    }
  }
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'slot-consumer-default', author: { user_openid: 'user' }, content: '默认状态' },
  });
  assert.equal(harness.messages.at(-1)!.payload.content, '梦江南');
  assert.equal(harness.messages.length, 5);
  assert.deepEqual(harness.errors, []);
} finally {
  await harness.app.close();
}
console.log('Slot aliases, defaults and a reusable decorator verified in the current tarball.');
