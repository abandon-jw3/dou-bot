import { Arg, Command, Controller, Injectable, Module } from '../src/index.js';
import { createTestApplication } from '../src/testing/index.js';

@Injectable()
class GreetingService {
  hello(name: string): string {
    return `你好，${name}！`;
  }
}

@Controller()
class GreetingController {
  constructor(private readonly greetings: GreetingService) {}

  @Command('hello', { aliases: ['hi'] })
  hello(@Arg(0) name: string = '朋友'): string {
    return this.greetings.hello(name);
  }
}

@Module({ providers: [GreetingService], controllers: [GreetingController] })
class AppModule {}

const harness = await createTestApplication(AppModule);
try {
  await harness.app.start();
  await harness.dispatch({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'example-private-message',
      author: { user_openid: 'test-user' },
      content: '/hello "Ada Lovelace"',
    },
  });
  await harness.dispatch({
    op: 0,
    t: 'GROUP_AT_MESSAGE_CREATE',
    d: {
      id: 'example-group-message',
      group_openid: 'test-group',
      author: { member_openid: 'test-member' },
      content: '/hi',
    },
  });
  for (const message of harness.messages)
    console.log(`${message.target.scene}: ${message.payload.content ?? ''}`);
  const failure = harness.errors[0];
  if (failure) throw failure.error;
} finally {
  await harness.app.close();
}
