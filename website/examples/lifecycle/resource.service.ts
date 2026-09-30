import { Injectable } from 'dou-bot';
import type { OnModuleInit, OnModuleDestroy } from 'dou-bot';

@Injectable()
export class PulseService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | undefined;
  ticks = 0;
  get running(): boolean {
    return this.timer !== undefined;
  }
  onModuleInit(signal: AbortSignal): void {
    signal.throwIfAborted();
    // 服务自己创建的资源，由自己的销毁钩子负责释放。
    this.timer = setInterval(() => {
      this.ticks++;
    }, 1000);
    this.timer.unref();
  }
  onModuleDestroy(_signal: AbortSignal): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
