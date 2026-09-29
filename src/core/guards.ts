import type { CanActivate, GuardContext, GuardResult, Type } from '../contracts.js';
import type { Clock } from './clock.js';
import type { EventTask } from './execution.js';
import { FrameworkError } from './errors.js';
import { bounded, callable, isObject, isRecord } from './utils.js';

export function guardContext(
  task: EventTask,
  controller: Type,
  method: string,
  route: string,
): GuardContext {
  const event = task.event;
  if (event.kind === 'event')
    throw new FrameworkError('INVALID_STATE', 'Raw observers do not have guards');
  const { client, ...base } = task.context();
  void client;
  const scene =
    event.target.scene === 'group'
      ? {
          scene: 'group' as const,
          groupId: event.target.groupId,
          target: Object.freeze({ ...event.target }),
        }
      : { scene: 'private' as const, target: Object.freeze({ ...event.target }) };
  return Object.freeze({
    ...base,
    ...scene,
    userId: event.userId,
    controller,
    method,
    route,
    ...(event.kind === 'message'
      ? {
          kind: 'command' as const,
          content: event.content,
          messageId: event.messageId,
          attachments: event.attachments,
        }
      : {
          kind: 'button' as const,
          interactionId: event.interactionId,
          buttonId: event.buttonId,
          data: event.data,
        }),
  });
}

export function assertGuard(guard: unknown): asserts guard is CanActivate {
  if (!isObject(guard) || !callable(Reflect.get(guard, 'canActivate')))
    throw new FrameworkError('HANDLER_CONTRACT', 'Guard provider must implement canActivate()');
}

export async function runGuard(
  guard: CanActivate,
  context: GuardContext,
  clock: Clock,
): Promise<GuardResult> {
  context.signal.throwIfAborted();
  assertGuard(guard);
  const result: unknown = await bounded(
    Promise.resolve(guard.canActivate(context)),
    Infinity,
    context.signal,
    clock,
  );
  context.signal.throwIfAborted();
  if (typeof result === 'boolean') return result;
  if (
    !isRecord(result) ||
    result.allow !== false ||
    Object.keys(result).some((key) => key !== 'allow' && key !== 'message') ||
    (result.message !== undefined && (typeof result.message !== 'string' || !result.message.trim()))
  )
    throw new FrameworkError(
      'HANDLER_CONTRACT',
      'Guard must return boolean or { allow: false, message?: string }',
    );
  return { allow: false, ...(result.message === undefined ? {} : { message: result.message }) };
}
