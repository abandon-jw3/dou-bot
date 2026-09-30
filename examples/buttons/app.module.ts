import { Command, Controller, Ctx, Module, OnButton, button, keyboard, markdown } from 'dou-bot';
import type { ButtonContext, MarkdownMessage } from 'dou-bot';

@Controller()
export class ButtonController {
  @Command('menu')
  menu(): MarkdownMessage {
    // 原始 Markdown 与内联键盘，不需要模板 ID。
    return markdown('**请选择操作**', {
      keyboard: keyboard([
        [button.callback('docs:confirm', '确认', 'confirm')],
        [button.link('阅读文档', 'https://abandon-jw3.github.io/dou-bot-docs/')],
        [button.command('再次打开', '/menu', { enter: true })],
      ]),
    });
  }
  @OnButton('docs:confirm')
  async confirm(@Ctx() ctx: ButtonContext): Promise<void> {
    // 默认 auto 已确认收到事件。回调 data 是不可信输入，需要业务自己检查。
    if (ctx.data !== 'confirm') {
      await ctx.send('不认识的操作。');
      return;
    }
    // 按钮上下文没有 reply；普通 send 能否发送仍由 QQ 平台权限决定。
    await ctx.send('确认成功。');
  }
}
@Module({ controllers: [ButtonController] })
export class AppModule {}
