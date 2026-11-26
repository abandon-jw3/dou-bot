import {
  Command,
  Controller,
  Ctx,
  GroupManagersOnly,
  GroupOnly,
  GroupRoles,
  OnButton,
  PrivateOnly,
  UsersOnly,
  button,
  keyboard,
  markdown,
} from 'dou-bot';
import type { ButtonContext, GroupMessageContext, MarkdownMessage } from 'dou-bot';

// @GroupOnly 写在类上，限制本类所有命令与按钮回调；无需注册 Guard Provider。
// 私聊会收到默认拒绝提示，且不会执行方法或占用冷却。
@Controller()
@GroupOnly()
export class ExampleGroupAccessController {
  @Command('example-group-only', { description: '内置 GroupOnly：仅群聊' })
  group(): string {
    return 'GroupOnly 已放行：当前是群聊。';
  }

  @Command('example-owner', { description: '内置 GroupRoles：仅群主' })
  // @GroupRoles 使用当前消息 author.member_role；列表中任意一个角色匹配即可。
  // owner=群主，admin=管理员，member=普通成员；缺失或未知角色不会放行。
  // 它只保护命令，不适用于 OnButton；按钮点击权限在发送时配置。
  @GroupRoles('owner')
  owner(@Ctx() ctx: GroupMessageContext): string {
    // 装饰器不会自动改变 TypeScript 类型，群消息上下文仍需显式标注。
    return `GroupRoles 已放行：当前角色是 ${ctx.memberRole}。`;
  }

  @Command('example-managers', { description: '内置 GroupManagersOnly：群主或管理员' })
  // @GroupManagersOnly 是 GroupRoles('owner', 'admin') 的快捷写法，隐含群聊限制。
  // 可传 message 自定义拒绝提示，或 message: false 静默拒绝。
  @GroupManagersOnly({ message: '此示例仅限群主或管理员。' })
  managers(): string {
    return 'GroupManagersOnly 已放行：你是群主或管理员。';
  }

  @Command('example-manager-button', { description: '发送仅管理者可点击的按钮' })
  @GroupManagersOnly()
  managerButton(): MarkdownMessage {
    // 命令装饰器检查发送指令的人；permission 则交给 QQ 检查点击按钮的人。
    // managers 映射 QQ permission.type=1；框架会在发送到私聊前直接拒绝。
    return markdown('**群管理示例**：仅管理者可点击。', {
      keyboard: keyboard([
        [
          button.callback('example:managers', '管理者确认', 'confirm', {
            permission: { type: 'managers' },
          }),
        ],
      ]),
    });
  }

  @OnButton('example:managers')
  async confirm(@Ctx() ctx: ButtonContext): Promise<void> {
    // 回调不依赖 member_role；QQ 负责上方按钮的点击限制，本类还限制群聊场景。
    // 不把“发送按钮的用户”当作“点击用户”，也不将交互 ID 当成消息引用。
    // 本示例只发固定提示，不执行真实群管理操作；实际业务仍需校验自己的数据。
    if (ctx.data !== 'confirm') {
      await ctx.send('管理者按钮数据不正确。');
      return;
    }
    await ctx.send('管理者按钮点击已处理。');
  }
}

// @PrivateOnly 可用于类或方法；与 GroupOnly 同时作用于同一处理器会在启动时报错。
@Controller()
@PrivateOnly()
export class ExamplePrivateAccessController {
  @Command('example-private-only', { description: '内置 PrivateOnly：仅私聊' })
  private(): string {
    return 'PrivateOnly 已放行：当前是私聊。';
  }

  @Command('example-users', { description: '内置 UsersOnly：指定私聊用户' })
  // @UsersOnly 名单填写 OpenID，不是 QQ 号；请将占位值改成自己的私聊 OpenID。
  // 此例默认拒绝真实用户，避免把示例白名单误当成已配置的管理权限。
  // scene 限定匹配范围；groupId 也可限定某个群。动态名单应使用自定义 Guard。
  @UsersOnly(['replace-with-your-private-openid'], {
    scene: 'private',
    message: '请先在示例代码的 UsersOnly 名单中配置你的私聊 OpenID。',
  })
  users(): string {
    return 'UsersOnly 已放行：你在指定用户名单中。';
  }
}
