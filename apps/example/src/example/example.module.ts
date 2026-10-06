import { HelpModule, Module } from 'dou-bot';
import { ExampleAttachmentsController } from './example-attachments.controller.ts';
import { ExampleIdentityController } from './example-identity.controller.ts';
import { ExampleController } from './example.controller.ts';
import { ExampleEventsController } from './example-events.controller.ts';
import { ExamplePrivateController } from './example-private.controller.ts';
import { ExamplePromptController } from './example-prompt.controller.ts';
import { ModuleGuardsExampleModule } from './module-guards/module-guards.module.ts';
import {
  ExampleGroupAccessController,
  ExamplePrivateAccessController,
} from './example-access.controller.ts';
import { GroupOnlyGuard, PrivateOnlyGuard } from './example.guard.ts';
import { EXAMPLE_SETTINGS, ExampleService } from './example.service.ts';
import type { ExampleSettings } from './example.service.ts';

// @Module 声明一个功能模块；模块类本身只承载配置，不作为服务实例化。
@Module({
  // imports 引入其他模块；HelpModule 提供 /help 和 /帮助，展示参数声明。
  imports: [HelpModule, ModuleGuardsExampleModule],
  // controllers 注册命令、按钮与事件处理器。
  controllers: [
    ExampleController,
    ExampleEventsController,
    ExamplePrivateController,
    ExampleGroupAccessController,
    ExamplePrivateAccessController,
    ExamplePromptController,
    ExampleAttachmentsController,
    ExampleIdentityController,
  ],
  // providers 注册服务、Guard 与配置；useValue 的令牌供 @Inject 使用。
  providers: [
    ExampleService,
    GroupOnlyGuard,
    PrivateOnlyGuard,
    {
      provide: EXAMPLE_SETTINGS,
      useValue: Object.freeze({ title: '装饰器示例' } satisfies ExampleSettings),
    },
  ],
  // exports 允许导入本模块的其他模块注入此服务；不导出的 Provider 保持模块内可见。
  exports: [ExampleService],
})
export class ExampleModule {}
