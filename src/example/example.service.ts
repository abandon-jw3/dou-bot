import { Inject, Injectable } from 'dd-bot';

// 接口在编译后会消失，因此用 Symbol 作为配置的运行时注入令牌。
export const EXAMPLE_SETTINGS = Symbol('EXAMPLE_SETTINGS');

export interface ExampleSettings {
  readonly title: string;
}

// @Injectable 标记可注入的服务；还需要在模块的 providers 中注册。
// 框架管理同一个应用内的服务单例，多个控制器会共享这里的事件计数。
@Injectable()
export class ExampleService {
  private messageCount = 0;
  private lastEventName = '无';

  constructor(
    // @Inject 显式指定构造参数的令牌，与模块中的 provide 对应。
    // 它用于构造注入，不能用于命令方法的参数。
    @Inject(EXAMPLE_SETTINGS) private readonly settings: ExampleSettings,
  ) {}

  get title(): string {
    return this.settings.title;
  }

  greet(name: string): string {
    return `${this.settings.title}：你好，${name}！`;
  }

  recordMessage(eventName: string): void {
    // 这里只记录数量和事件名称，不保存消息正文或用户身份。
    this.messageCount += 1;
    this.lastEventName = eventName;
  }

  describeEvents(): string {
    return `消息事件数：${this.messageCount}；最近事件：${this.lastEventName}`;
  }
}
