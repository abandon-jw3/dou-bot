import type { ErrorContext, ErrorHandler, Logger } from '../contracts.js';
import { errorOf, FrameworkError, QQApiError } from './errors.js';
import { bounded } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';

export const LOGGER: unique symbol = Symbol('dd-bot.logger');

export class ErrorReporter {
  readonly logger: Logger;
  private readonly queue: { error: Error; context: ErrorContext }[] = [];
  private active = false;
  private disabled = false;
  private closed = false;
  private dropped = 0;
  private readonly closing = new AbortController();
  constructor(
    private readonly sensitive: () => readonly string[],
    private readonly handler?: ErrorHandler,
    private readonly timeout = 1000,
    sink?: Logger,
    private readonly clock: Clock = systemClock,
  ) {
    const fallback = (
      level: string,
      message: string,
      fields?: Readonly<Record<string, unknown>>,
    ) => {
      try {
        process.stderr.write(
          `${JSON.stringify({ level, time: new Date(this.clock.wallTime()).toISOString(), message, ...fields })}\n`,
        );
      } catch {
        /* Logging cannot stop the runtime. */
      }
    };
    const log = (
      level: keyof Logger,
      message: string,
      fields?: Readonly<Record<string, unknown>>,
    ) => {
      try {
        const safeMessage = this.redact(message);
        const safeFields = this.sanitize(fields) as Readonly<Record<string, unknown>> | undefined;
        if (sink) sink[level](safeMessage, safeFields);
        else if (level !== 'debug') fallback(level, safeMessage, safeFields);
      } catch {
        fallback('error', 'Logger failed');
      }
    };
    this.logger = {
      debug: (message, fields) => log('debug', message, fields),
      info: (message, fields) => log('info', message, fields),
      warn: (message, fields) => log('warn', message, fields),
      error: (message, fields) => log('error', message, fields),
    };
  }

  redact(value: string): string {
    let result = value;
    for (const secret of this.sensitive())
      if (secret) result = result.split(secret).join('[redacted]');
    return result.length > 2048 ? `${result.slice(0, 2048)}…` : result;
  }

  private sanitize(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
    if (typeof value === 'string') return this.redact(value);
    if (value === null || typeof value !== 'object') return value;
    if (depth >= 3 || seen.has(value)) return '[truncated]';
    seen.add(value);
    if (value instanceof Error) return { name: value.name, message: this.redact(value.message) };
    if (Array.isArray(value))
      return value.slice(0, 20).map((item: unknown) => this.sanitize(item, depth + 1, seen));
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 30)
        .map(([key, item]: [string, unknown]) => [
          this.redact(key),
          /secret|token|authorization|signature|file_data|body/i.test(key)
            ? '[redacted]'
            : this.sanitize(item, depth + 1, seen),
        ]),
    );
  }

  private safeError(value: unknown): Error {
    const original = errorOf(value);
    const message = this.redact(original.message);
    const error =
      original instanceof QQApiError
        ? new QQApiError(message, {
            method: original.method,
            path: this.redact(original.path),
            ...(original.httpStatus === undefined ? {} : { httpStatus: original.httpStatus }),
            ...(original.qqCode === undefined
              ? {}
              : {
                  qqCode:
                    typeof original.qqCode === 'string'
                      ? this.redact(original.qqCode)
                      : original.qqCode,
                }),
            ...(original.traceId === undefined ? {} : { traceId: this.redact(original.traceId) }),
          })
        : original instanceof FrameworkError
          ? new FrameworkError(original.code, message)
          : new Error(message);
    if (!(error instanceof FrameworkError)) error.name = this.redact(original.name);
    return error;
  }
  report(value: unknown, context: ErrorContext): void {
    if (this.handler && !this.disabled && !this.closed && this.queue.length >= 32) {
      this.dropped++;
      return;
    }
    let error: Error;
    try {
      error = this.safeError(value);
    } catch {
      error = new Error('Thrown error details could not be inspected');
    }
    this.logger.error(error.message, {
      ...context,
      error: error.name,
      ...(error instanceof FrameworkError ? { errorCode: error.code } : {}),
      ...(error instanceof QQApiError
        ? { qqCode: error.qqCode, httpStatus: error.httpStatus, traceId: error.traceId }
        : {}),
    });
    if (!this.handler || this.disabled || this.closed) return;
    this.queue.push({ error, context });
    if (!this.active)
      this.consume().catch(() => {
        this.disabled = true;
      });
  }

  private async consume(): Promise<void> {
    this.active = true;
    try {
      while (this.queue.length && !this.disabled && !this.closed) {
        const entry = this.queue.shift();
        if (!entry || !this.handler) break;
        try {
          await bounded(
            Promise.resolve().then(() => this.handler?.(entry.error, entry.context)),
            this.clock.monotonic() + this.timeout,
            this.closing.signal,
            this.clock,
          );
        } catch {
          if (this.closed) return;
          this.disabled = true;
          this.queue.length = 0;
          this.logger.error('Custom error handler failed or exceeded its deadline; it is disabled');
        }
        this.flushDropped();
      }
    } finally {
      this.active = false;
    }
  }
  close(): void {
    this.closed = true;
    this.queue.length = 0;
    this.flushDropped();
    this.closing.abort(new FrameworkError('INVALID_STATE', 'Error reporter is closed'));
  }
  private flushDropped(): void {
    if (!this.dropped) return;
    const dropped = this.dropped;
    this.dropped = 0;
    this.logger.warn('Error handler queue was full; additional reports were dropped', { dropped });
  }
}
