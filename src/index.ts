import 'reflect-metadata/lite';

export * from './contracts.js';
export { FrameworkError, QQApiError } from './core/errors.js';
export {
  Module,
  Injectable,
  Inject,
  Controller,
  Command,
  On,
  OnButton,
  Ctx,
  Arg,
  Args,
  Option,
  Slot,
  Rest,
  UseGuards,
  Cooldown,
} from './core/metadata.js';
export { HelpModule } from './core/help.js';
export { BotFactory } from './core/factory.js';
export { LOGGER } from './core/logging.js';
export { text, image, markdown, keyboard, button } from './message/index.js';
