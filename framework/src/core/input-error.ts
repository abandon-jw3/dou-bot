import { FrameworkError } from './errors.js';

/** Only errors created by the input parser may be sent back to a chat. */
export class CommandInputError extends FrameworkError {
  constructor(message: string) {
    super('PARAMETER_PARSE', message);
  }
}
