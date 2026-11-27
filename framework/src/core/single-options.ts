import type { AppOptions, BotOptions, TransportOptions } from '../contracts.js';

export type SharedOptions = Pick<
  AppOptions,
  | 'commands'
  | 'execution'
  | 'context'
  | 'prompts'
  | 'logger'
  | 'onError'
  | 'onHandlerError'
  | 'providers'
  | 'middlewares'
>;
export type AccountOptions = Omit<BotOptions, 'transport'> & { transport?: TransportOptions };
export type SingleBotOptions = SharedOptions & AccountOptions;
