import type { RequestOptions } from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import { FrameworkError } from '../core/errors.js';
import { bounded } from '../core/utils.js';
import { systemClock } from '../core/clock.js';
import type { Clock } from '../core/clock.js';
import type { Diagnostics } from '../diagnostics/observer.js';
import type { DiagnosticsOperation } from '../diagnostics/contracts.js';

function operation(url: string): DiagnosticsOperation {
  try {
    const path = new URL(url).pathname;
    if (/\/messages(?:\/[^/]+)?$/u.test(path)) return 'message';
    if (path.endsWith('/files')) return 'upload';
    if (path.includes('/interactions/')) return 'interaction';
    if (path === '/gateway') return 'gateway';
  } catch {
    /* Diagnostics must not change the fetcher's URL handling. */
  }
  return 'other';
}

export type FetchPort = typeof globalThis.fetch;
export class HttpRuntime {
  private state: 'open' | 'draining' | 'closed' = 'open';
  private readonly requests = new Set<AbortController>();
  private readonly waiters = new Set<() => void>();
  managed: (signal: AbortSignal | undefined) => boolean = () => false;
  constructor(
    private readonly options: ResolvedOptions,
    private readonly fetcher: FetchPort = fetch,
    private readonly clock: Clock = systemClock,
    readonly observer?: Diagnostics,
  ) {}
  assertAllowed(signal?: AbortSignal, internal = false): void {
    signal?.throwIfAborted();
    if (
      this.state === 'closed' ||
      (this.state === 'draining' && !internal && !this.managed(signal))
    )
      throw new FrameworkError('INVALID_STATE', 'Application no longer accepts this request');
  }
  deadline(timeoutMs?: number): number {
    const timeout = timeoutMs ?? this.options.api.requestTimeoutMs;
    if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 2147483647)
      throw new FrameworkError('CONFIG', 'Invalid request timeout');
    return this.clock.monotonic() + timeout;
  }
  async request(
    url: string,
    init: RequestInit,
    options: RequestOptions = {},
    internal = false,
    deadline = this.deadline(options.timeoutMs),
  ): Promise<{ response: Response; text: string }> {
    this.assertAllowed(options.signal, internal);
    const controller = new AbortController();
    const signals = [controller.signal, ...(options.signal ? [options.signal] : [])];
    const signal = AbortSignal.any(signals);
    const inherited = this.observer?.context(options.signal);
    const context = this.observer
      ? {
          ...(inherited ?? this.observer.root(this.options.appId)),
          appId: this.options.appId,
          operation: inherited?.operation ?? operation(url),
        }
      : undefined;
    const total = this.observer?.start('qq.http', context, signal);
    const headers = this.observer?.start('qq.http.headers', total?.context ?? context, signal);
    let body: ReturnType<Diagnostics['start']>;
    this.requests.add(controller);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await bounded(
        this.fetcher(url, { ...init, redirect: 'manual', signal }),
        deadline,
        signal,
        this.clock,
      );
      headers?.end(response.ok ? 'success' : 'rejected');
      body = this.observer?.start('qq.http.body', total?.context ?? context, signal);
      reader = response.body?.getReader();
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > this.options.api.maxResponseBytes)
        throw new FrameworkError('RESOURCE_LIMIT', 'QQ response is too large');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      if (reader) {
        while (true) {
          const result = await bounded(reader.read(), deadline, signal, this.clock);
          if (result.done) break;
          bytes += result.value.byteLength;
          if (bytes > this.options.api.maxResponseBytes)
            throw new FrameworkError('RESOURCE_LIMIT', 'QQ response is too large');
          chunks.push(result.value);
        }
      }
      const content = Buffer.concat(chunks, bytes);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
      body?.end();
      total?.end(response.ok ? 'success' : 'rejected');
      return { response, text };
    } catch (error) {
      headers?.fail(error, signal);
      body?.fail(error, signal);
      total?.fail(error, signal);
      controller.abort(error);
      if (reader) reader.cancel(error).catch(() => {});
      if (error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT')
        throw new FrameworkError('TRANSPORT', 'QQ HTTP request timed out');
      throw error;
    } finally {
      headers?.end();
      body?.end();
      total?.end();
      reader?.releaseLock();
      this.requests.delete(controller);
      for (const waiter of [...this.waiters]) waiter();
    }
  }
  beginDrain(): void {
    this.state = 'draining';
  }
  async drain(deadline: number): Promise<void> {
    if (!this.requests.size) return;
    let done!: () => void;
    const pending = new Promise<void>((resolve) => {
      done = resolve;
    });
    const check = () => {
      if (!this.requests.size) done();
    };
    this.waiters.add(check);
    try {
      check();
      await bounded(pending, deadline, undefined, this.clock);
    } finally {
      this.waiters.delete(check);
    }
  }
  close(): void {
    this.state = 'closed';
    for (const controller of this.requests)
      controller.abort(new FrameworkError('INVALID_STATE', 'QQ client is closed'));
  }
}
