import { Command, Controller, Ctx, Module } from '../src/index.js';
import type { MessageContext } from '../src/index.js';
import { createMultiTestApplication } from '../src/testing/index.js';

@Controller()
class Commands {
  @Command('诊断')
  async inspect(@Ctx() ctx: MessageContext): Promise<void> {
    const first = ctx.reply('第一条');
    const second = ctx.reply('第二条');
    await Promise.all([first, second]);
  }
}
@Module({ controllers: [Commands] })
class Root {}

// This offline harness exercises the actual runtime without QQ or PostgreSQL.
const h = await createMultiTestApplication(Root, {
  diagnostics: { enabled: true, traceSampleRate: 1 },
});
await h.app.start();
try {
  await h.dispatch('offline-app', {
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: { id: 'fixture', content: '/诊断', author: { user_openid: 'fixture-user' } },
  });
  const snapshot = h.app.diagnostics.snapshot();
  console.table(
    snapshot.metrics.map(({ stage, count, totalMs, active, p95UpperMs }) => ({
      stage,
      count,
      totalMs,
      active,
      p95UpperMs,
    })),
  );
  console.log('sampled spans', h.app.diagnostics.takeSpans().length);
} finally {
  await h.app.close();
}
