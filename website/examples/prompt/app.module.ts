import { Command, Controller, Ctx, Module } from 'dou-bot';
import type { MessageContext } from 'dou-bot';

@Controller()
export class SurveyController {
  @Command('报名')
  async enroll(@Ctx() ctx: MessageContext): Promise<void> {
    // 必须 await：等待项与当前处理器的生命周期绑定。
    const name = await ctx.prompt('请输入角色名，发送“取消”结束。');
    if (name.status !== 'received') {
      await ctx.reply(name.status === 'timeout' ? '等待超时。' : '已取消。');
      return;
    }
    if (!name.message.content.trim()) {
      await name.message.reply('角色名不能为空。');
      return;
    }
    // 使用新消息的上下文继续提问，避免多轮对话一直引用最初的命令。
    const server = await name.message.prompt('请输入服务器名称。');
    if (server.status !== 'received') {
      await name.message.reply(server.status === 'timeout' ? '等待超时。' : '已取消。');
      return;
    }
    await server.message.reply(`已记录：${name.message.content} / ${server.message.content}`);
    // 已经手动发送，返回 void，避免重复自动回复。
  }

  @Command('等待')
  async wait(@Ctx() ctx: MessageContext): Promise<void> {
    const result = await ctx.prompt('请在 5 秒内输入内容，或发送“取消”。', { timeoutMs: 5000 });
    if (result.status === 'received') await result.message.reply(`收到：${result.message.content}`);
    else await ctx.reply(result.status === 'timeout' ? '等待超时。' : '已取消。');
  }
}
@Module({ controllers: [SurveyController] })
export class AppModule {}
