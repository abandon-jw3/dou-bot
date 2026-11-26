import { FrameworkError } from '../core/errors.js';

/** QQ sends seconds as JSON numbers or decimal strings, never coerced booleans/arrays. */
export function lifetimeSeconds(value: unknown): number {
  const seconds =
    typeof value === 'number' || (typeof value === 'string' && /^\d+(?:\.\d+)?$/u.test(value))
      ? Number(value)
      : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isSafeInteger(seconds * 1000))
    throw new FrameworkError('PROTOCOL', 'Invalid QQ lifetime');
  return seconds;
}
