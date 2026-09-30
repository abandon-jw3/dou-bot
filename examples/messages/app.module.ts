import { Command, Controller, Ctx, Module, image, markdown, text } from 'dou-bot';
import type { ImageMessage, MarkdownMessage, MessageContext, TextMessage } from 'dou-bot';
import { fixtureImage } from './fixture-image.js';

@Controller()
export class MessageController {
  @Command('text') text(): TextMessage {
    return text('你好，这是文本消息。');
  }
  @Command('image') image(): ImageMessage {
    return image(fixtureImage(), { caption: '本地生成的彩色方格' });
  }
  @Command('markdown') markdown(): MarkdownMessage {
    return markdown('**你好**，这是原始 Markdown。');
  }
  @Command('manual')
  async manual(@Ctx() ctx: MessageContext): Promise<void> {
    // reply 自动引用当前消息并管理回复序号。发送后返回 void。
    await ctx.reply('这条消息由 ctx.reply 发送。');
  }
}
@Module({ controllers: [MessageController] })
export class AppModule {}
