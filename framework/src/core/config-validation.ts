import type { FrameworkErrorCode } from '../contracts.js';
import { FrameworkError } from './errors.js';
import { isRecord } from './utils.js';

export function keys(
  value: unknown,
  allowed: readonly string[],
  label: string,
  code: FrameworkErrorCode = 'CONFIG',
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new FrameworkError(code, `${label} must be an object`);
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) throw new FrameworkError(code, `Unknown ${label}.${key}`);
}
export function integer(
  value: unknown,
  fallback: number,
  label: string,
  minimum = 1,
  maximum = 2147483647,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    throw new FrameworkError('CONFIG', `${label} must be an integer in [${minimum}, ${maximum}]`);
  return value;
}
/** Dense array check without allocating an Array.from copy; sparse holes fail validation. */
export function everyDense(
  array: readonly unknown[],
  predicate: (value: unknown) => boolean,
): boolean {
  for (let index = 0; index < array.length; index++)
    if (!(index in array) || !predicate(array[index])) return false;
  return true;
}
