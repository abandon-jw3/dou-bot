import type { InjectionToken, Type } from '../contracts.js';
import { errorOf, FrameworkError } from './errors.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const isObject = (value: unknown): value is object =>
  (typeof value === 'object' && value !== null) || typeof value === 'function';
export const isType = (value: unknown): value is Type =>
  typeof value === 'function' && isObject(value.prototype);
export const tokenName = (token: InjectionToken): string =>
  typeof token === 'function' ? token.name || '(anonymous class)' : String(token);
export const own = (object: object, key: PropertyKey): boolean =>
  Object.prototype.hasOwnProperty.call(object, key);

export function hasControlCharacters(value: string, includeSpace = false): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < (includeSpace ? 33 : 32) || code === 127) return true;
  }
  return false;
}

export function nonempty(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FrameworkError('CONFIG', `${name} must be a non-empty string`);
  }
}

export function callable(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function';
}

const deadlineError = () => new FrameworkError('SHUTDOWN_TIMEOUT', 'Deadline exceeded');

export function bounded<T>(
  promise: PromiseLike<T>,
  deadline: number,
  signal?: AbortSignal,
  clock: Clock = systemClock,
  timeoutError: () => Error = deadlineError,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let finished = false;
    const settle = (operation: () => void, checkDeadline = true) => {
      if (finished) return;
      finished = true;
      timer?.cancel();
      signal?.removeEventListener('abort', abort);
      // Promise jobs can run before a due timer after synchronous work blocked the event loop.
      if (checkDeadline && clock.monotonic() >= deadline) reject(timeoutError());
      else operation();
    };
    const abort = () =>
      settle(
        () =>
          reject(
            errorOf(signal?.reason ?? new FrameworkError('INVALID_STATE', 'Operation cancelled')),
          ),
        false,
      );
    const remaining = deadline - clock.monotonic();
    const timer =
      Number.isFinite(deadline) && remaining > 0
        ? clock.timeout(() => settle(() => reject(timeoutError()), false), remaining)
        : undefined;
    if (remaining <= 0) settle(() => reject(timeoutError()), false);
    else if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(
      (value) => settle(() => resolve(value)),
      (error: unknown) => settle(() => reject(errorOf(error))),
    );
  });
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw signal.reason ?? new FrameworkError('INVALID_STATE', 'Operation cancelled');
}
