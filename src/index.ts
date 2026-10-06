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
  OnAttachment,
  Ctx,
  User,
  UserId,
  Group,
  GroupId,
  Role,
  Arg,
  Args,
  Option,
  Slot,
  Rest,
  Attachments,
  Images,
  UseGuards,
  GroupOnly,
  PrivateOnly,
  UsersOnly,
  GroupRoles,
  GroupManagersOnly,
  Cooldown,
} from './core/metadata.js';
export { selectAttachments } from './core/attachments.js';
export { HelpModule } from './core/help.js';
export { BotFactory } from './core/factory.js';
export { LOGGER } from './core/logging.js';
export { text, image, markdown, keyboard, button } from './message/index.js';
