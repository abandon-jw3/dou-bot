import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http';
import type { ResolvedOptions } from '../core/config.js';
import type { Execution } from '../core/execution.js';
import type { ErrorReporter } from '../core/logging.js';
import { FrameworkError } from '../core/errors.js';
import { bounded, hasControlCharacters, isRecord, own } from '../core/utils.js';
import { isDispatch } from '../qq/normalize.js';
import type { Transport } from './types.js';
import { systemClock } from '../core/clock.js';
import type { Clock } from '../core/clock.js';

export class WebhookVerifier {
  private readonly privateKey;
  private readonly publicKey;
  constructor(
    secret: string,
    private readonly maximumAge: number,
    private readonly now: () => number = () => systemClock.wallTime(),
  ) {
    const source = Buffer.from(secret, 'utf8');
    if (!source.length) throw new FrameworkError('CONFIG', 'Webhook secret is required');
    const seed = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) seed[i] = source[i % source.length] ?? 0;
    this.privateKey = createPrivateKey({
      key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
      format: 'der',
      type: 'pkcs8',
    });
    this.publicKey = createPublicKey(this.privateKey);
  }
  fresh(value: string): boolean {
    return (
      value.trim() === value &&
      /^[0-9]{1,16}$/u.test(value) &&
      Number.isSafeInteger(Number(value) * 1000) &&
      Math.abs(this.now() - Number(value) * 1000) <= this.maximumAge
    );
  }
  verify(timestamp: string, rawBody: Uint8Array, signature: string): boolean {
    if (!this.fresh(timestamp) || signature.length !== 128 || !/^[a-f0-9]{128}$/iu.test(signature))
      return false;
    return verify(
      null,
      Buffer.concat([Buffer.from(timestamp), rawBody]),
      this.publicKey,
      Buffer.from(signature, 'hex'),
    );
  }
  signChallenge(eventTs: string, token: string): string {
    if (
      !this.fresh(eventTs) ||
      !token ||
      Buffer.byteLength(token) > 256 ||
      hasControlCharacters(token) ||
      token.includes('{') ||
      token.includes('[')
    )
      throw new FrameworkError('PROTOCOL', 'Invalid verification challenge');
    return sign(null, Buffer.from(eventTs + token), this.privateKey).toString('hex');
  }
}

class HttpFailure extends Error {
  constructor(readonly status: number) {
    super(`Webhook HTTP ${status}`);
  }
}
function readBody(
  request: IncomingMessage,
  maximum: number,
  timeout: number,
  clock: Clock,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const end = () => finish();
    const error = () => finish(new HttpFailure(400));
    const data = (chunk: unknown) => {
      if (!Buffer.isBuffer(chunk)) return finish(new HttpFailure(400));
      size += chunk.length;
      if (size > maximum) return finish(new HttpFailure(413));
      chunks.push(chunk);
    };
    const finish = (failure?: Error) => {
      if (settled) return;
      settled = true;
      timer.cancel();
      request.off('data', data);
      request.off('end', end);
      request.off('aborted', error);
      if (failure) reject(failure);
      else resolve(Buffer.concat(chunks, size));
    };
    const timer = clock.timeout(() => finish(new HttpFailure(408)), timeout);
    request.on('data', data);
    request.once('end', end);
    // An aborted request can emit error after 'aborted'. Keep the listener
    // until close even when reading has already settled.
    request.on('error', error);
    request.once('close', () => {
      if (!settled) finish(new HttpFailure(400));
      request.off('error', error);
    });
    request.once('aborted', error);
    if (request.destroyed || request.readableEnded) finish(new HttpFailure(400));
  });
}

export class WebhookTransport implements Transport {
  readonly handler: RequestListener;
  private readonly settings: Extract<ResolvedOptions['transport'], { type: 'webhook' }>;
  private readonly verifier: WebhookVerifier;
  private readonly requests = new Set<IncomingMessage>();
  private server: Server | undefined;
  private running = false;
  private closing = false;
  constructor(
    private readonly config: ResolvedOptions,
    private readonly execution: Execution,
    private readonly reporter: ErrorReporter,
    private readonly clock: Clock = systemClock,
  ) {
    if (config.transport.type !== 'webhook')
      throw new FrameworkError('CONFIG', 'Expected Webhook configuration');
    this.settings = config.transport;
    this.verifier = new WebhookVerifier(config.secret, this.settings.maxSignatureAgeMs, () =>
      this.clock.wallTime(),
    );
    this.handler = (request, response) => {
      this.handle(request, response).catch((error: unknown) => {
        this.reporter.report(error, { phase: 'protocol', appId: this.config.appId });
        if (!response.headersSent) this.reply(response, 500);
        else response.destroy();
      });
    };
  }
  private reply(response: ServerResponse, status: number, body: unknown = {}): void {
    if (response.destroyed || response.writableEnded) return;
    response.statusCode = status;
    response.setHeader('content-type', 'application/json');
    if (status >= 400) response.setHeader('connection', 'close');
    response.end(JSON.stringify(body));
  }
  private header(request: IncomingMessage, name: string, required: boolean): string | undefined {
    let count = 0;
    for (let i = 0; i < request.rawHeaders.length; i += 2)
      if (request.rawHeaders[i]?.toLowerCase() === name) count++;
    const value = request.headers[name];
    if (
      count > 1 ||
      (required && count !== 1) ||
      (value !== undefined && typeof value !== 'string')
    )
      throw new HttpFailure(403);
    return value;
  }
  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (request.url?.split('?')[0] !== this.settings.path) {
      this.reply(response, 404);
      return;
    }
    if (request.method !== 'POST') {
      this.reply(response, 405);
      return;
    }
    if (!this.running || this.requests.size >= this.settings.maxConcurrentRequests) {
      this.reply(response, 503);
      return;
    }
    this.requests.add(request);
    try {
      if (
        request.headers['content-encoding'] !== undefined &&
        request.headers['content-encoding'] !== 'identity'
      )
        throw new HttpFailure(415);
      if (this.header(request, 'x-bot-appid', true) !== this.config.appId)
        throw new HttpFailure(403);
      const raw = await readBody(
        request,
        this.settings.maxBodyBytes,
        this.settings.readTimeoutMs,
        this.clock,
      );
      let payload: unknown;
      try {
        payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      } catch {
        throw new HttpFailure(400);
      }
      if (!isRecord(payload) || !own(payload, 'op') || !own(payload, 'd'))
        throw new HttpFailure(400);
      const signature = this.header(request, 'x-signature-ed25519', false);
      const timestamp = this.header(request, 'x-signature-timestamp', false);
      if ((signature === undefined) !== (timestamp === undefined)) throw new HttpFailure(403);
      if (
        signature !== undefined &&
        timestamp !== undefined &&
        !this.verifier.verify(timestamp, raw, signature)
      )
        throw new HttpFailure(403);
      if (payload.op === 13) {
        if (
          !isRecord(payload.d) ||
          typeof payload.d.event_ts !== 'string' ||
          typeof payload.d.plain_token !== 'string'
        )
          throw new HttpFailure(400);
        let signed: string;
        try {
          signed = this.verifier.signChallenge(payload.d.event_ts, payload.d.plain_token);
        } catch {
          throw new HttpFailure(400);
        }
        this.reply(response, 200, { plain_token: payload.d.plain_token, signature: signed });
      } else {
        if (!isDispatch(payload) || raw.length > this.config.execution.maxEventBytes)
          throw new HttpFailure(400);
        if (signature === undefined || timestamp === undefined) throw new HttpFailure(403);
        const result = this.execution.accept(payload, raw.length);
        if (result.status === 'failed') throw new HttpFailure(500);
        if (result.status === 'overloaded' || result.status === 'stopping')
          throw new HttpFailure(503);
        this.reply(response, 200, { op: 12, d: {} });
      }
    } catch (error) {
      if (error instanceof HttpFailure) {
        response.once('finish', () => {
          if (!request.complete) request.destroy();
        });
        this.reply(response, error.status);
      } else throw error;
    } finally {
      this.requests.delete(request);
    }
  }
  async start(): Promise<void> {
    if (this.closing) throw new FrameworkError('INVALID_STATE', 'Webhook is closed');
    if (this.settings.listen) {
      const server = createServer(this.handler);
      this.server = server;
      server.on('error', (error) =>
        this.reporter.report(error, { phase: 'transport', appId: this.config.appId }),
      );
      await new Promise<void>((resolve, reject) => {
        const error = (failure: Error) => {
          server.off('listening', listening);
          reject(failure);
        };
        const listening = () => {
          server.off('error', error);
          resolve();
        };
        server.once('error', error);
        server.once('listening', listening);
        server.listen(this.settings.port, this.settings.host);
      });
    }
    if (this.closing) {
      this.server?.closeAllConnections();
      this.server?.close();
      throw new FrameworkError('INVALID_STATE', 'Webhook stopped during startup');
    }
    this.running = true;
  }
  async stop(deadline: number): Promise<void> {
    this.closing = true;
    this.running = false;
    if (!this.server) {
      for (const request of this.requests) request.destroy();
      return;
    }
    const closing = new Promise<void>((resolve) => this.server?.close(() => resolve()));
    try {
      await bounded(closing, deadline, undefined, this.clock);
    } finally {
      this.server.closeAllConnections();
      for (const request of this.requests) request.destroy();
    }
  }
}
