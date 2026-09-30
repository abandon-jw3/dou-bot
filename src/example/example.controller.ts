import {
  Arg,
  Args,
  Command,
  Controller,
  Cooldown,
  Ctx,
  OnButton,
  Option,
  Rest,
  Slot,
  UseGuards,
  button,
  keyboard,
  markdown,
} from 'dd-bot';
import type { ButtonContext, MarkdownMessage, MessageContext } from 'dd-bot';
import { GroupOnlyGuard } from './example.guard.js';
// 类依赖必须使用值导入；import type 会使构造注入所需的运行时类型丢失。
import { ExampleService } from './example.service.js';

const cities = new Set(['北京', '上海', '广州']);

// @Controller 标记处理命令和事件的类；模块的 controllers 负责注册它。
@Controller()
export class ExampleController {
  // 类类型可通过 TypeScript 生成的元数据自动注入，不必再写 @Inject。
  constructor(private readonly examples: ExampleService) {}

  // @Command 注册命令；名称不含前缀，aliases 是别名，description 用于帮助。
  // 本项目使用默认 / 前缀，因此 /example 和 /示例 都会进入同一方法。
  @Command('example', { aliases: ['示例'], description: '查看全部装饰器示例入口' })
  index(): string {
    // 返回字符串会自动回复；HelpModule 另外提供 /help 和 /帮助。
    return [
      this.examples.title,
      '/example-arg 小明 2：位置参数',
      '/example-args 小明 "两个 单词" --flag：全部分词',
      '/example-option --name 小明 --times 2 --shout：选项',
      '/example-slot 明天 散步 北京 带伞 --detail：无序参数与剩余参数',
      '/example-context：手动回复',
      '/example-group：方法级 Guard',
      '/example-private：类级 Guard',
      '/example-cooldown：同一用户 3 秒冷却',
      '/example-button：发送回调按钮',
      '/example-events：查看原始事件计数',
      '/example-group-only、/example-private-only：内置场景限制',
      '/example-owner、/example-managers：群角色限制',
      '/example-users：指定 OpenID（需先修改示例名单）',
      '/example-manager-button：管理者按钮',
      '/example-prompt：两轮文字输入',
      '/example-prompt-image：等待图片',
      '/example-prompt-timeout：5 秒超时或取消',
      '/example-module-info：模块级 Guard',
      '/example-module-settings：模块 + 类级 Guard',
      '/example-module-owner：模块 + 类 + 方法级 Guard',
      '/help example-slot：查看参数帮助',
    ].join('\n');
  }

  @Command('example-arg', { description: '按位置绑定名字和重复次数' })
  positional(
    // @Arg 的下标从 0 开始；required 会让缺参成为输入错误。
    @Arg(0, { name: '名字', required: true }) name: string,
    // type 决定运行时转换；仅写 TypeScript 的 : number 不会自动转换。
    // default 与 required: true 不能同时使用；次数必须是 1～3 的整数。
    @Arg(1, { name: '次数', type: 'integer', min: 1, max: 3, default: 1 }) times: number,
  ): string {
    return Array.from({ length: times }, () => this.examples.greet(name)).join('\n');
  }

  @Command('example-args', { description: '查看命令后完整的分词快照' })
  allArguments(
    // @Args 包含所有分词，包括 --flag、选项值和 --，不包含命令名本身。
    // 引号已由分词器处理，所以 "两个 单词" 是一个元素，不是原始文本切片。
    // 它不消费参数，也不能代替严格参数模式下的 @Rest 接收多余参数。
    @Args() args: readonly string[],
  ): string {
    return `全部参数：${JSON.stringify(args)}`;
  }

  @Command('example-option', { description: '演示字符串、整数、布尔值及短选项' })
  options(
    // @Option 按名称取值；支持 --name 小明、--name=小明 和 -n 小明。
    @Option('name', { alias: 'n', type: 'string', default: '朋友' }) name: string,
    @Option('times', { alias: 't', type: 'integer', min: 1, max: 3, default: 1 }) times: number,
    // --shout 或 -s 表示 true；false 必须写成 --shout=false。
    // 不支持 -st2 这样的短选项组合，重复或未知选项会被拒绝。
    @Option('shout', { alias: 's', type: 'boolean', default: false }) shout: boolean,
  ): string {
    const greeting = this.examples.greet(name);
    return Array.from({ length: times }, () => (shout ? `大声说：${greeting}` : greeting)).join(
      '\n',
    );
  }

  @Command('example-slot', { description: '识别任意位置的城市和活动，并收集剩余文字' })
  slots(
    // @Slot 从尚未消费的分词中按规则识别参数，不依赖输入顺序。
    // match 必须同步且无副作用，不能在这里发起网络查询。
    @Slot('city', { name: '城市', required: true, match: (word) => cities.has(word) }) city: string,
    // choices 也能定义 Slot 规则。重复匹配、歧义或缺参都会报错。
    @Slot('activity', { name: '活动', required: true, choices: ['散步', '骑行'] }) activity: string,
    // @Rest 收集未被 Arg/Slot/Option 消费的普通分词，保留顺序；无剩余时为 []。
    // 一个命令只能有一个 Rest；写普通数组参数，不能写 JavaScript 的 ...rest。
    @Rest({ name: '备注' }) notes: string[],
    // 选项先于 Slot/Rest 解析，因此 --detail 不会落进 notes。
    @Option('detail', { alias: 'd', type: 'boolean', default: false }) detail: boolean,
  ): string {
    // 只回显参数解析结果，不调用任何城市或天气服务。
    return [
      `城市：${city}`,
      `活动：${activity}`,
      `剩余：${notes.length ? notes.join(' / ') : '无'}`,
      ...(detail ? ['详细：是'] : []),
    ].join('；');
  }

  @Command('example-context', { description: '通过上下文手动回复当前会话' })
  async context(
    // @Ctx 注入当前调用上下文；命令使用 MessageContext，可读 scene/content 等。
    // 不要把上下文存进单例，供当前调用结束后的定时任务继续使用。
    @Ctx() ctx: MessageContext,
  ): Promise<void> {
    const scene = ctx.scene === 'group' ? '群聊' : '私聊';
    await ctx.reply(`当前会话：${scene}。此回复来自 ctx.reply()。`);
    // 已手动 reply 后返回 void，不能再返回字符串触发第二次自动回复。
  }

  @Command('example-group', { description: '方法级 Guard：只允许群聊' })
  // @UseGuards 写在方法上只保护该处理器，传 Provider 令牌，不传 new Guard()。
  // Guard 先于参数绑定和冷却执行；多个 Guard 按声明顺序逐个检查。
  @UseGuards(GroupOnlyGuard)
  groupOnly(): string {
    return '方法级 Guard 已放行：当前是群聊。';
  }

  @Command('example-cooldown', { aliases: ['示例冷却'], description: '按会话内用户限制调用频率' })
  // @Cooldown 用在 Command/OnButton 方法上；同一方法的命令别名共享冷却。
  // user = 会话内同一用户；session = 同一会话；command = 该处理器全部调用者。
  // 它是进程内的调用冷却，不是互斥锁；业务执行失败也不会退还本次名额。
  @Cooldown({ scope: 'user', durationMs: 3000, message: '请等待 3 秒后再试。' })
  cooldown(): string {
    return '冷却示例执行成功。';
  }

  @Command('example-button', { description: '发送一个由 OnButton 处理的回调按钮' })
  showButton(): MarkdownMessage {
    // 这些是消息构建函数，不是装饰器；callback 的 ID 要与下方 OnButton 一致。
    // 使用原始 Markdown 和内联键盘。默认保留点击后的按钮文字。
    return markdown('**装饰器示例**：点击下面的按钮。', {
      keyboard: keyboard([[button.callback('example:confirm', '确认示例', 'hello')]]),
    });
  }

  // @OnButton 按 callback 按钮 ID 路由；链接按钮、命令按钮不进入此回调。
  @OnButton('example:confirm')
  async confirmButton(@Ctx() ctx: ButtonContext): Promise<void> {
    // 默认 auto 模式已确认收到点击。若配置为 manual，处理器中需 await ctx.ack()。
    // 确认收到不代表业务成功；data 是不可信的字符串，不会自动解析或鉴权。
    if (ctx.data !== 'hello') {
      await ctx.send('示例按钮数据不正确。');
      return;
    }
    // 此示例允许所有点击者，仅发送固定提示，不执行有权限要求的业务。
    // ButtonContext 没有 reply；send 是普通发送，仍受 QQ 平台发送权限限制。
    // interactionId 只能用于确认，不能伪装成普通消息的 msg_id。
    await ctx.send('已收到你的按钮点击。');
    // OnButton 必须返回 void，不能像命令那样返回字符串自动回复。
  }

  @Command('example-events', { description: '查看 On 观察器累计收到的消息事件' })
  events(): string {
    // On 观察器先独立执行，所以计数包含触发此命令的消息；应用重启后归零。
    return this.examples.describeEvents();
  }
}
