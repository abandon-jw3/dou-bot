import type { Application, AppOptions, Type } from '../contracts.js';
import { Application as RuntimeApplication } from './application.js';

export const AppFactory = {
  create: async (root: Type, options: AppOptions): Promise<Application> =>
    RuntimeApplication.create(root, options),
};
