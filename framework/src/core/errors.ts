import type { FrameworkErrorCode, HttpMethod } from '../contracts.js';

export class FrameworkError extends Error {
  override readonly name: string = 'FrameworkError';
  constructor(
    readonly code: FrameworkErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class QQApiError extends FrameworkError {
  override readonly name = 'QQApiError';
  readonly httpStatus?: number;
  readonly qqCode?: number | string;
  readonly traceId?: string;
  readonly method: HttpMethod;
  readonly path: string;
  constructor(
    message: string,
    details: {
      method: HttpMethod;
      path: string;
      httpStatus?: number;
      qqCode?: number | string;
      traceId?: string;
      cause?: unknown;
    },
  ) {
    super('QQ_API', message, details.cause === undefined ? undefined : { cause: details.cause });
    if (details.httpStatus !== undefined) this.httpStatus = details.httpStatus;
    if (details.qqCode !== undefined) this.qqCode = details.qqCode;
    if (details.traceId !== undefined) this.traceId = details.traceId;
    this.method = details.method;
    this.path = details.path;
  }
}

export function errorOf(value: unknown): Error {
  try {
    return value instanceof Error ? value : new Error(String(value));
  } catch {
    return new Error('Thrown value could not be inspected');
  }
}
