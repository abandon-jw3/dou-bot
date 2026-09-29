import type { BotApplication, BotOptions, Type } from '../contracts.js';
import { Application } from './application.js';

// Keep private runtime ports out of the package's public declaration graph.
export const BotFactory = {
  create: async (root: Type, options: BotOptions): Promise<BotApplication> =>
    Application.create(root, options),
};
