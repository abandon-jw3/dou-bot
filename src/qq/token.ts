import type { ResolvedOptions } from '../core/config.js';
import type { ErrorReporter } from '../core/logging.js';
import { FrameworkError, QQApiError } from '../core/errors.js';
import { isRecord } from '../core/utils.js';
import type { HttpRuntime } from './http.js';
import { systemClock } from '../core/clock.js';
import type { Clock, Timer } from '../core/clock.js';
import { lifetimeSeconds } from './lifetime.js';

export class TokenManager {
  private token = '';
  private previous = '';
  private expiresAt = 0;
  private pending: Promise<string> | undefined;
  private timer: Timer | undefined;
  private controller: AbortController | undefined;
  private generation = 0;
  private closed = false;
  private suspended = false;
  private retries = 0;
  constructor(
    private readonly config: ResolvedOptions,
    private readonly http: HttpRuntime,
    private readonly reporter: ErrorReporter,
    private readonly clock: Clock = systemClock,
  ) {}
  sensitive(): readonly string[] {
    return [this.config.secret, this.token, this.previous];
  }
  getToken(): Promise<string> {
    if (this.closed)
      return Promise.reject(new FrameworkError('INVALID_STATE', 'Token manager is closed'));
    if (this.token && this.clock.monotonic() < this.expiresAt) return Promise.resolve(this.token);
    return this.refresh();
  }
  refresh(): Promise<string> {
    if (this.closed)
      return Promise.reject(new FrameworkError('INVALID_STATE', 'Token manager is closed'));
    if (this.pending) return this.pending;
    this.timer?.cancel();
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const request = this.fetchToken(generation, controller.signal);
    this.pending = request;
    request.then(
      () => {
        if (this.pending === request) this.pending = undefined;
      },
      () => {
        if (this.pending === request) this.pending = undefined;
      },
    );
    return request;
  }
  private async fetchToken(generation: number, signal: AbortSignal): Promise<string> {
    const started = this.clock.monotonic();
    try {
      const { response, text } = await this.http.request(
        this.config.api.tokenEndpoint,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ appId: this.config.appId, clientSecret: this.config.secret }),
        },
        { signal },
        true,
      );
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        throw new FrameworkError('PROTOCOL', 'Invalid QQ token response');
      }
      if (
        !response.ok ||
        (isRecord(body) && body.code !== undefined && body.code !== 0 && body.code !== '0')
      ) {
        const message =
          isRecord(body) && typeof body.message === 'string'
            ? this.reporter.redact(body.message)
            : 'QQ token request failed';
        throw new QQApiError(message, {
          method: 'POST',
          path: '/app/getAppAccessToken',
          httpStatus: response.status,
          ...(isRecord(body) && (typeof body.code === 'number' || typeof body.code === 'string')
            ? { qqCode: body.code }
            : {}),
        });
      }
      const seconds = lifetimeSeconds(isRecord(body) ? body.expires_in : undefined);
      if (!isRecord(body) || typeof body.access_token !== 'string' || !body.access_token)
        throw new FrameworkError('PROTOCOL', 'Invalid QQ access token or lifetime');
      if (this.closed || generation !== this.generation)
        throw new FrameworkError('INVALID_STATE', 'Stale token refresh');
      const expiresAt = started + seconds * 1000;
      const remaining = expiresAt - this.clock.monotonic();
      if (remaining <= 0) {
        throw new FrameworkError('PROTOCOL', 'Token expired while being fetched');
      }
      this.previous = this.token;
      this.token = body.access_token;
      this.expiresAt = expiresAt;
      this.retries = 0;
      this.schedule(Math.max(1, remaining > 40000 ? remaining - 40000 : remaining / 2));
      return this.token;
    } catch (error) {
      if (!this.closed && generation === this.generation && !signal.aborted)
        this.schedule(Math.min(30000, 1000 * 2 ** Math.min(this.retries++, 5)));
      throw error;
    }
  }
  private schedule(delay: number): void {
    this.timer?.cancel();
    if (this.closed || this.suspended) return;
    this.timer = this.clock.timeout(
      () => {
        this.refresh().catch((error: unknown) =>
          this.reporter.report(error, { phase: 'transport', appId: this.config.appId }),
        );
      },
      Math.min(2147483647, delay),
    );
    this.timer.unref();
  }
  invalidate(): void {
    this.generation++;
    this.token = '';
    this.expiresAt = 0;
    this.controller?.abort(new FrameworkError('INVALID_STATE', 'Token invalidated'));
    this.pending = undefined;
    this.timer?.cancel();
  }
  suspend(): void {
    this.suspended = true;
    this.timer?.cancel();
  }
  close(): void {
    this.closed = true;
    this.suspend();
    this.invalidate();
  }
}
