import type {
  TransportOptions,
  QQApiOptions,
  ExecutionOptions,
  ContextOptions,
  PromptConfig,
  Logger,
  ErrorHandler,
} from '../contracts.js';

/** Internal per-account settings, also used by the offline test adapter. */
export interface SingleBotOptions {
  appId: string;
  secret: string;
  transport?: TransportOptions;
  api?: QQApiOptions;
  commands?: {
    /** Exact, case-sensitive prefix. Defaults to '/'; '' allows bare command names. No whitespace. */
    prefix?: string;
    /** Report all errors; optionally reply with safe command-input diagnostics. Defaults to 'report'. */
    invalidInput?: 'report' | 'reply';
  };
  execution?: ExecutionOptions;
  context?: ContextOptions;
  prompts?: PromptConfig;
  interactions?: {
    acknowledge?: 'auto' | 'manual';
  };
  logger?: Logger;
  onError?: ErrorHandler;
}
