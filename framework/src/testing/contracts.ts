import type { BotSnapshot, BotStatus, InjectionToken, Type } from '../contracts.js';
import type { RequestListener } from 'node:http';
import type { DiagnosticsReader } from '../diagnostics/contracts.js';

export interface TestApplication {
  readonly diagnostics: DiagnosticsReader;
  readonly status: BotStatus;
  readonly client: import('../contracts.js').QQClient;
  start(): Promise<void>;
  close(): Promise<void>;
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T;
  webhookHandler(): RequestListener;
  snapshot(): BotSnapshot;
}
