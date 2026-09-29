import WebSocket from 'ws';
import type { ClientOptions, RawData } from 'ws';
import type { QQApi, ApplicationStatus } from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import type { Execution } from '../core/execution.js';
import type { ErrorReporter } from '../core/logging.js';
import type { TokenManager } from '../qq/token.js';
import { errorOf, FrameworkError } from '../core/errors.js';
import { bounded, isRecord } from '../core/utils.js';
import { isDispatch } from '../qq/normalize.js';
import type { Transport } from './types.js';
import { systemClock } from '../core/clock.js';
import type { Clock, Timer } from '../core/clock.js';

export type SocketFactory = (url: string, options: ClientOptions) => WebSocket;

export class WsTransport implements Transport {
  private readonly settings: Extract<ResolvedOptions['transport'], { type: 'ws' }>;
  private readonly controller = new AbortController();
  private socket: WebSocket | undefined;
  private loopPromise: Promise<void> | undefined;
  private sessionId = '';
  private received: number | null = null;
  private accepted: number | null = null;
  private everReady = false;
  private pressured = false;
  private cachedGateway: { url: string; expiresAt: number } | undefined;
  private generation = 0;
  private retry = 0;
  private settleStart: (() => void) | undefined;
  private failStart: ((error: unknown) => void) | undefined;
  constructor(
    private readonly config: ResolvedOptions,
    private readonly api: QQApi,
    private readonly tokens: TokenManager,
    private readonly execution: Execution,
    private readonly reporter: ErrorReporter,
    private readonly status: (status: ApplicationStatus) => void,
    private readonly random: () => number = Math.random,
    private readonly clock: Clock = systemClock,
    private readonly socketFactory: SocketFactory = (url, options) => new WebSocket(url, options),
  ) {
    if (config.transport.type !== 'ws')
      throw new FrameworkError('CONFIG', 'Expected WS configuration');
    this.settings = config.transport;
  }
  start(): Promise<void> {
    if (this.loopPromise || this.controller.signal.aborted)
      return Promise.reject(
        new FrameworkError('INVALID_STATE', 'WS has already started or stopped'),
      );
    const ready = new Promise<void>((resolve, reject) => {
      this.settleStart = resolve;
      this.failStart = reject;
    });
    this.loopPromise = this.loop().catch((error: unknown) => {
      this.failStart?.(error);
      if (!this.controller.signal.aborted)
        this.reporter.report(error, { phase: 'transport', appId: this.config.appId });
    });
    return ready;
  }
  private async wait(delay: number): Promise<void> {
    const signal = this.controller.signal;
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener('abort', abort);
        resolve();
      };
      const timer = this.clock.timeout(finish, delay);
      const abort = () => {
        timer.cancel();
        signal.removeEventListener('abort', abort);
        reject(errorOf(signal.reason));
      };
      signal.addEventListener('abort', abort, { once: true });
    });
  }
  private async loop(): Promise<void> {
    let attempts = 0;
    while (!this.controller.signal.aborted) {
      attempts++;
      try {
        if (this.pressured) {
          await this.execution.waitForCapacity(this.controller.signal);
          this.pressured = false;
        }
        await this.connect();
      } catch (error) {
        if (this.controller.signal.aborted) break;
        this.reporter.report(error, { phase: 'transport', appId: this.config.appId });
      }
      if (this.controller.signal.aborted) break;
      if (!this.everReady && attempts >= this.settings.retry.initialAttempts)
        throw new FrameworkError('TRANSPORT', 'QQ initial connection attempts exhausted');
      if (this.everReady) this.status('reconnecting');
      const base = Math.min(
        this.settings.retry.maxDelayMs,
        this.settings.retry.baseDelayMs * 2 ** Math.min(this.retry++, 20),
      );
      await this.wait(
        Math.max(
          this.settings.retry.baseDelayMs,
          Math.min(this.settings.retry.maxDelayMs, Math.round(base * (0.8 + this.random() * 0.4))),
        ),
      );
    }
  }
  private async connect(): Promise<void> {
    const signal = this.controller.signal;
    const deadline = this.clock.monotonic() + this.settings.connectTimeoutMs;
    const accessToken = await bounded(this.tokens.getToken(), deadline, signal, this.clock);
    if (
      !this.settings.gatewayUrl &&
      (!this.cachedGateway || this.cachedGateway.expiresAt <= this.clock.monotonic())
    ) {
      const gateway = await bounded(this.api.getGateway({ signal }), deadline, signal, this.clock);
      this.cachedGateway = { url: gateway.url, expiresAt: this.clock.monotonic() + 60000 };
    }
    const url = this.settings.gatewayUrl ?? this.cachedGateway?.url;
    if (!url) throw new FrameworkError('TRANSPORT', 'Gateway discovery returned no URL');
    signal.throwIfAborted();
    const socket = this.socketFactory(url, {
      maxPayload: this.config.execution.maxEventBytes,
      perMessageDeflate: false,
      followRedirects: false,
      headers: { Authorization: `QQBot ${accessToken}`, 'X-Union-Appid': this.config.appId },
      handshakeTimeout: Math.max(1, deadline - this.clock.monotonic()),
    });
    this.socket = socket;
    const generation = ++this.generation;
    await new Promise<void>((resolve, reject) => {
      let heartbeat: Timer | undefined;
      let closingTimer: Timer | undefined;
      let pendingAck = false;
      let hello = false;
      let identified = false;
      let closing = false;
      let ready = false;
      let failure: unknown;
      const current = () => !closing && !signal.aborted && generation === this.generation;
      const shutdown = (error?: unknown) => {
        if (closing) return;
        closing = true;
        failure = error;
        heartbeat?.cancel();
        startup.cancel();
        socket.close();
        closingTimer = this.clock.timeout(() => socket.terminate(), this.settings.closeTimeoutMs);
      };
      const startup = this.clock.timeout(
        () => shutdown(new FrameworkError('TRANSPORT', 'QQ READY handshake timed out')),
        Math.max(1, deadline - this.clock.monotonic()),
      );
      const send = (payload: unknown) => {
        if (!current() || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify(payload), (error) => {
          if (error) shutdown(error);
        });
      };
      const beat = (forced = false) => {
        if (pendingAck && !forced) {
          shutdown(new FrameworkError('TRANSPORT', 'QQ heartbeat acknowledgment timed out'));
          return;
        }
        send({ op: 1, [this.settings.heartbeatSequenceField]: this.received });
        pendingAck = true;
      };
      const receive = async (data: RawData) => {
        if (!current()) return;
        const bytes = Array.isArray(data)
          ? Buffer.concat(data)
          : Buffer.isBuffer(data)
            ? data
            : Buffer.from(data);
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        } catch {
          // Native JSON errors can quote the incoming body. Keep protocol logs body-free.
          throw new FrameworkError('PROTOCOL', 'Gateway frame is not valid UTF-8 JSON');
        }
        if (!isRecord(payload)) throw new FrameworkError('PROTOCOL', 'Invalid gateway payload');
        if (payload.op === 10) {
          if (
            hello ||
            !isRecord(payload.d) ||
            !Number.isSafeInteger(payload.d.heartbeat_interval) ||
            typeof payload.d.heartbeat_interval !== 'number' ||
            payload.d.heartbeat_interval <= 0 ||
            payload.d.heartbeat_interval > 2147483647
          )
            throw new FrameworkError('PROTOCOL', 'Invalid gateway HELLO');
          hello = true;
          const token = await bounded(this.tokens.getToken(), deadline, signal, this.clock);
          if (!current()) return;
          send(
            this.sessionId
              ? {
                  op: 6,
                  d: { token: `QQBot ${token}`, session_id: this.sessionId, seq: this.accepted },
                }
              : {
                  op: 2,
                  d: { token: `QQBot ${token}`, intents: this.settings.intents, shard: [0, 1] },
                },
          );
          identified = true;
          heartbeat = this.clock.interval(() => beat(), payload.d.heartbeat_interval);
        } else if (payload.op === 11) {
          pendingAck = false;
          this.reporter.logger.debug('QQ heartbeat acknowledged');
        } else if (payload.op === 1) beat(true);
        else if (payload.op === 7) shutdown();
        else if (payload.op === 9) {
          if (this.sessionId)
            this.reporter.logger.warn('QQ session rejected; event continuity cannot be confirmed');
          this.sessionId = '';
          this.accepted = null;
          this.received = null;
          shutdown(new FrameworkError('TRANSPORT', 'QQ session is invalid'));
        } else if (payload.op === 0) {
          if (
            !identified ||
            !isDispatch(payload) ||
            !Number.isSafeInteger(payload.s) ||
            (payload.s ?? -1) < 0
          )
            throw new FrameworkError('PROTOCOL', 'Invalid gateway Dispatch');
          this.reporter.logger.debug('QQ event received', {
            type: payload.t,
            fields: isRecord(payload.d) ? Object.keys(payload.d) : [],
          });
          this.received = Math.max(this.received ?? 0, payload.s ?? 0);
          if (payload.t === 'READY') {
            if (ready) throw new FrameworkError('PROTOCOL', 'Duplicate READY event');
            if (
              !isRecord(payload.d) ||
              typeof payload.d.session_id !== 'string' ||
              !payload.d.session_id
            )
              throw new FrameworkError('PROTOCOL', 'Missing session id');
            if (this.sessionId && this.sessionId !== payload.d.session_id)
              this.reporter.logger.warn(
                'QQ replaced the session; event continuity cannot be confirmed',
              );
            this.sessionId = payload.d.session_id;
            this.accepted = payload.s ?? null;
            this.received = payload.s ?? null;
            ready = true;
            this.retry = 0;
          } else if (payload.t === 'RESUMED') {
            if (!this.sessionId) throw new FrameworkError('PROTOCOL', 'Unexpected RESUMED event');
            ready = true;
            this.retry = 0;
          } else if (!ready)
            throw new FrameworkError('PROTOCOL', 'Business event arrived before READY');
          if (ready && !this.everReady) {
            this.everReady = true;
            this.settleStart?.();
          }
          if (ready) {
            startup.cancel();
            this.status('running');
          }
          const result = this.execution.accept(payload, bytes.length);
          if (result.status === 'overloaded') {
            this.pressured = true;
            shutdown();
          } else if (result.status === 'stopping' || result.status === 'failed') shutdown();
          else if (payload.t !== 'RESUMED')
            this.accepted = Math.max(this.accepted ?? 0, payload.s ?? 0);
        }
      };
      const abort = () => shutdown(new FrameworkError('INVALID_STATE', 'WS transport stopped'));
      signal.addEventListener('abort', abort, { once: true });
      socket.on('message', (data: RawData) => {
        receive(data).catch(shutdown);
      });
      socket.on('error', (error) => {
        failure = error;
        shutdown(error);
      });
      socket.once('close', (code) => {
        this.reporter.logger.debug('QQ WebSocket closed', { code });
        closing = true;
        startup.cancel();
        closingTimer?.cancel();
        heartbeat?.cancel();
        signal.removeEventListener('abort', abort);
        if (this.socket === socket) this.socket = undefined;
        if (code > 4000 && ![4008, 4009].includes(code)) {
          if (this.sessionId)
            this.reporter.logger.warn(
              'QQ closed an unrecoverable session; event continuity cannot be confirmed',
              { code },
            );
          this.sessionId = '';
          this.received = null;
          this.accepted = null;
        }
        if (failure && !signal.aborted) reject(errorOf(failure));
        else resolve();
      });
    });
  }
  async stop(deadline: number): Promise<void> {
    this.controller.abort(new FrameworkError('INVALID_STATE', 'WS stopped'));
    this.failStart?.(new FrameworkError('INVALID_STATE', 'WS stopped before ready'));
    if (!this.loopPromise) return;
    try {
      await bounded(
        this.loopPromise,
        Math.min(deadline, this.clock.monotonic() + this.settings.closeTimeoutMs),
        undefined,
        this.clock,
      );
    } catch {
      this.socket?.terminate();
    } finally {
      this.socket?.terminate();
    }
  }
}
