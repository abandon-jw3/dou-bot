import { Command, Controller, Ctx } from 'dou-bot';
import type { MessageContext } from 'dou-bot';

@Controller()
export class ExamplePromptController {
  @Command('example-prompt', { description: '两轮输入：角色名与服务器' })
  async dialog(@Ctx() ctx: MessageContext): Promise<void> {
    // prompt 会先登记等待，再发送问题，避免快速回复在等待建立之前到达。
    // 默认等待 60 秒，只匹配当前用户和会话；群里其他人可以同时运行自己的对话。
    const name = await ctx.prompt('请在 60 秒内输入角色名，发送“取消”退出：');
    if (name.status !== 'received') return;

    // received 也可能是空文字或图片，输入格式由业务自己验证。
    const roleName = name.message.content.trim();
    if (!roleName) {
      await name.message.reply('角色名不能为空，本次示例结束。');
      return;
    }

    // 下一轮使用新输入的 message.prompt，提问就会引用这条新消息。
    // 不要把上下文保存在单例服务中；原命令结束后，它的发送/等待能力会失效。
    const server = await name.message.prompt('请在 60 秒内输入服务器，发送“取消”退出：');
    if (server.status !== 'received') return;
    const serverName = server.message.content.trim();
    if (!serverName) {
      await server.message.reply('服务器不能为空，本次示例结束。');
      return;
    }

    // 回复引用第二轮输入。这里只回显结果，不写数据库或请求外部业务接口。
    await server.message.reply(`角色名：${roleName}\n服务器：${serverName}`);
    // prompt 已发送问题，因此方法返回 void，不能再 return 字符串自动回复。
  }

  @Command('example-prompt-image', { description: '等待图片输入并读取附件' })
  async image(@Ctx() ctx: MessageContext): Promise<void> {
    const answer = await ctx.prompt('请发送一张图片，60 秒内有效，发送“取消”退出：');
    if (answer.status !== 'received') return;

    // 不只返回字符串，才能处理纯图片消息。content 为空并不代表超时。
    const image = answer.message.attachments.find((item) => item.contentType?.startsWith('image/'));
    if (!image) {
      await answer.message.reply('未收到图片，本次示例结束。');
      return;
    }
    // 示例只读取附件信息，不下载或保存用户图片。
    await answer.message.reply(`收到图片：${image.filename ?? '未命名图片'}`);
  }

  @Command('example-prompt-timeout', { description: '演示 5 秒超时和取消词' })
  async timeout(@Ctx() ctx: MessageContext): Promise<void> {
    // 单次可覆盖超时和取消词；[] 可以关闭取消词识别。
    const result = await ctx.prompt('请在 5 秒内回复，发送“取消”或 cancel 退出：', {
      timeoutMs: 5000,
      cancelWords: ['取消', 'cancel'],
    });
    if (result.status !== 'received') {
      // 框架不自动发送结束提示；本例由业务明确发送。
      // 没有可用的新输入上下文时，仍在当前流程内使用原 ctx 回复。
      await ctx.reply(result.status === 'timeout' ? '等待已超时。' : '已取消输入。');
      return;
    }
    await result.message.reply(`收到输入：${result.message.content}`);
  }
}
