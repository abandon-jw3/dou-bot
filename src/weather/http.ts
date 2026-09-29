import { Inject, Injectable } from 'dd-bot';
import { CONFIG, HTTP_FETCH } from '../config.js';
import type { AppConfig } from '../config.js';

export class WeatherError extends Error {
  constructor(
    readonly code:
      'NETWORK' | 'TIMEOUT' | 'HTTP' | 'INVALID_DATA' | 'BODY_LIMIT' | 'CITY_NOT_FOUND',
  ) {
    super(`Weather request failed: ${code}`);
  }
}
export const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      const reason: unknown = signal.reason;
      reject(reason instanceof Error ? reason : new Error('Request cancelled'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', abort);
        reject(error instanceof Error ? error : new Error('Request failed'));
      },
    );
  });
}

@Injectable()
export class WeatherHttp {
  constructor(
    @Inject(HTTP_FETCH) private readonly fetcher: typeof fetch,
    @Inject(CONFIG) private readonly config: AppConfig,
  ) {}
  async json(url: URL, external: AbortSignal): Promise<unknown> {
    external.throwIfAborted();
    if (
      url.protocol !== 'https:' ||
      !['api.open-meteo.com', 'geocoding-api.open-meteo.com'].includes(url.hostname) ||
      url.username ||
      url.password
    )
      throw new WeatherError('INVALID_DATA');
    const timeout = AbortSignal.timeout(this.config.requestTimeoutMs);
    const signal = AbortSignal.any([external, timeout]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    try {
      const pending = this.fetcher(url, {
        signal,
        redirect: 'error',
        headers: { Accept: 'application/json' },
      });
      pending.then(
        (late) => {
          if (signal.aborted) late.body?.cancel().catch(() => {});
        },
        () => {},
      );
      response = await cancellable(pending, signal);
      if (!response.ok) throw new WeatherError('HTTP');
      const maxBytes = 262144;
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > maxBytes) throw new WeatherError('BODY_LIMIT');
      reader = response.body?.getReader();
      if (!reader) throw new WeatherError('INVALID_DATA');
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const next = await cancellable(reader.read(), signal);
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > maxBytes) throw new WeatherError('BODY_LIMIT');
        chunks.push(next.value);
      }
      signal.throwIfAborted();
      try {
        return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) as unknown;
      } catch {
        throw new WeatherError('INVALID_DATA');
      }
    } catch (error) {
      if (external.aborted) throw external.reason;
      if (timeout.aborted) throw new WeatherError('TIMEOUT');
      if (error instanceof WeatherError) throw error;
      throw new WeatherError('NETWORK');
    } finally {
      if (reader) {
        reader.cancel().catch(() => {});
        reader.releaseLock();
      } else response?.body?.cancel().catch(() => {});
    }
  }
}
