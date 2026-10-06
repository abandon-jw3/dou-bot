import assert from 'node:assert/strict';
import {
  Attachments,
  Command,
  Controller,
  Ctx,
  Injectable,
  Module,
  OnAttachment,
  UserId,
  UseGuards,
} from 'dou-bot';
import type {
  Attachment,
  CanActivate,
  GuardContext,
  MessageContext,
  OnAttachmentOptions,
} from 'dou-bot';
import { createTestApplication } from 'dou-bot/testing';

const options: OnAttachmentOptions = {
  filename: /^report_\d+\.docx$/i,
  extension: '.docx',
  kind: 'file',
};
let guarded = 0;
@Injectable()
class Gate implements CanActivate {
  canActivate(ctx: GuardContext): boolean {
    if (ctx.kind === 'attachment') {
      assert.ok(Object.isFrozen(ctx.matchedAttachments));
      assert.equal(ctx.matchedAttachments.length, 1);
      assert.equal(ctx.attachments.length, 2);
      guarded++;
    }
    return true;
  }
}
@Controller()
class Uploads {
  @OnAttachment(options)
  @UseGuards(Gate)
  aReport(@Attachments() files: readonly Attachment[], @UserId() id: string): string {
    assert.equal(id, 'user');
    assert.ok(Object.isFrozen(files));
    return `matched:${files[0]?.filename}`;
  }
  @OnAttachment(options) async bQuestion(@Ctx() ctx: MessageContext): Promise<void> {
    const answer = await ctx.prompt('choose');
    assert.equal(answer.status, 'received');
    if (answer.status === 'received')
      await answer.message.reply(`chosen:${answer.message.content}`);
  }
  @OnAttachment(options) cAfter(): string {
    return 'after';
  }
  @Command('known') known(): string {
    return 'command';
  }
}
@Module({ controllers: [Uploads], providers: [Gate] })
class Root {}
const harness = await createTestApplication(Root);
await harness.app.start();
try {
  const start = harness.enqueue({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'upload',
      author: { user_openid: 'user' },
      content: '',
      attachments: [
        { url: 'https://example.invalid/doc', filename: 'report_1.docx', content_type: 'file' },
        { url: 'https://example.invalid/png', filename: 'photo.png', content_type: 'image/png' },
      ],
    },
  });
  assert.ok('done' in start);
  for (let i = 0; i < 100 && harness.messages.length < 2; i++)
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  assert.equal(harness.messages[1]?.payload.content, 'choose');
  const input = harness.enqueue({
    op: 0,
    t: 'C2C_MESSAGE_CREATE',
    d: {
      id: 'answer',
      author: { user_openid: 'user' },
      content: 'extract',
    },
  });
  assert.ok('done' in input);
  await start.done;
  await input.done;
  assert.deepEqual(
    harness.messages.map((m) => m.payload.content),
    ['matched:report_1.docx', 'choose', 'chosen:extract', 'after'],
  );
  assert.deepEqual(
    harness.messages.map((m) => [m.payload.msg_id, m.payload.msg_seq]),
    [
      ['upload', 1],
      ['upload', 2],
      ['answer', 1],
      ['upload', 3],
    ],
  );
  assert.equal(guarded, 1);
  assert.equal(harness.errors.length, 0);
} finally {
  await harness.app.close();
}
console.log('Independent attachment route consumer passed.');
