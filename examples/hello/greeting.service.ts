import { Inject, Injectable } from 'dou-bot';

// Symbol 是配置的运行时令牌；接口本身不会存在于编译后的 JavaScript 中。
export const GREETING_SETTINGS = Symbol('greeting-settings');
export interface GreetingSettings {
  salutation: string;
}

@Injectable()
export class GreetingService {
  constructor(@Inject(GREETING_SETTINGS) private readonly settings: GreetingSettings) {}
  hello(name: string): string {
    return `${this.settings.salutation}，${name}！`;
  }
}
