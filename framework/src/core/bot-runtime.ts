import type {
  BotSnapshot,
  BotStatus,
  MessageTarget,
  OutgoingMessage,
  SendOptions,
  SendResult,
} from '../contracts.js';
import type { RequestListener } from 'node:http';
import type { ResolvedOptions } from './config.js';
import type { Dispatcher } from './dispatcher.js';
import { Execution } from './execution.js';
import type { ExecutionPool } from './execution-pool.js';
import type { OutboundQueue } from './outbound.js';
import type { PersistentGroupRoutes } from './group-routes.js';
import { FrameworkError } from './errors.js';
import { ErrorReporter } from './logging.js';
import { bounded } from './utils.js';
import type { Clock } from './clock.js';
import { HttpRuntime } from '../qq/http.js';
import type { FetchPort } from '../qq/http.js';
import { TokenManager } from '../qq/token.js';
import { HttpQQApi } from '../qq/api.js';
import { DefaultQQClient } from '../qq/client.js';
import { ManagedQQClient } from '../qq/managed-client.js';
import { WebhookTransport } from '../transport/webhook.js';
import { WsTransport } from '../transport/ws.js';
import type { SocketFactory } from '../transport/ws.js';
import type { Transport } from '../transport/types.js';

export interface AccountPorts {
  fetch?: FetchPort;
  transport?: () => Transport;
  random?: () => number;
  socketFactory?: SocketFactory;
}
export class BotRuntime {
  status: BotStatus = 'created';
  readonly client: ManagedQQClient;
  readonly rawClient: DefaultQQClient;
  readonly execution: Execution;
  readonly transport: Transport;
  readonly http: HttpRuntime;
  readonly tokens: TokenManager;
  readonly reporter: ErrorReporter;
  private readonly startup = new AbortController();
  private readonly sendingSignals = new Set<AbortSignal>();
  private starting?: Promise<void>;
  private closing?: Promise<void>;
  constructor(
    readonly config: ResolvedOptions,
    private readonly dispatcher: Dispatcher,
    routes: PersistentGroupRoutes,
    private readonly outgoing: OutboundQueue,
    incoming: ExecutionPool,
    private readonly clock: Clock,
    private readonly changed: () => void,
    ports: AccountPorts,
    sensitive: () => readonly string[],
    applicationAccepting: () => boolean,
  ) {
    this.reporter = new ErrorReporter(
      () => [...sensitive(), ...(this.tokens?.sensitive() ?? [])],
      config.onError,
      config.execution.errorHandlerTimeoutMs,
      config.logger,
      clock,
    );
    this.http = new HttpRuntime(config, ports.fetch, clock);
    this.tokens = new TokenManager(config, this.http, this.reporter, clock);
    const api = new HttpQQApi(config, this.http, this.tokens, clock);
    this.rawClient = new DefaultQQClient(api, config, clock);
    this.client = new ManagedQQClient(
      this.rawClient,
      config,
      outgoing,
      (signal) => {
        signal?.throwIfAborted();
        const managed =
          signal !== undefined &&
          (this.execution.managedSignals.has(signal) || this.sendingSignals.has(signal));
        if (!applicationAccepting() && !managed)
          throw new FrameworkError(
            'INVALID_STATE',
            'Application is not accepting background sends',
          );
        if (
          this.status !== 'running' &&
          this.status !== 'reconnecting' &&
          !(this.status === 'stopping' && managed)
        )
          throw new FrameworkError('BOT_UNAVAILABLE', 'Sending bot is not running');
      },
      this.sendingSignals,
      (signal) => this.execution.managedSignals.has(signal),
      (error) => this.reporter.report(error, { phase: 'send', appId: config.appId }),
      clock,
    );
    this.execution = new Execution(
      config,
      this.client,
      this.reporter,
      (task) => {
        if (task.controller.signal.aborted) return Promise.resolve();
        // Private/raw events need no storage work or extra async boundary.
        if (
          task.event.kind === 'event' ||
          task.event.target.scene !== 'group' ||
          routes.hasLearned(config.appId, task.event.target.groupId)
        )
          return dispatcher.dispatch(task);
        return bounded(
          routes.observe(config.appId, task.event.target.groupId),
          Infinity,
          task.controller.signal,
          clock,
        )
          .catch((error: unknown) => task.report(error, 'routing'))
          .then(() => (task.controller.signal.aborted ? undefined : dispatcher.dispatch(task)));
      },
      (event) =>
        dispatcher.handles(event) ||
        (event.kind !== 'event' &&
        event.target.scene === 'group' &&
        !routes.hasObserved(config.appId, event.target.groupId)
          ? 'observe'
          : false),
      clock,
      incoming,
    );
    this.http.managed = (signal) =>
      signal !== undefined &&
      (this.execution.managedSignals.has(signal) || this.sendingSignals.has(signal));
    this.transport =
      ports.transport?.() ??
      (config.transport.type === 'webhook'
        ? new WebhookTransport(config, this.execution, this.reporter, clock)
        : new WsTransport(
            config,
            api,
            this.tokens,
            this.execution,
            this.reporter,
            (status) => {
              if (this.status === 'running' || this.status === 'reconnecting') {
                this.status = status;
                changed();
              }
            },
            ports.random,
            clock,
            ports.socketFactory,
          ));
  }
  sendAdmitted(
    target: MessageTarget,
    message: OutgoingMessage,
    options: SendOptions,
  ): Promise<SendResult> {
    return this.client.sendAdmitted(target, message, options);
  }
  webhookHandler(): RequestListener | undefined {
    return this.transport.handler;
  }
  snapshot(): BotSnapshot {
    return {
      status: this.status,
      transport: this.config.transport.type,
      queue: this.execution.snapshot(),
      prompts: this.execution.promptSnapshot(),
      events: { ...this.execution.events },
      ...this.execution.metrics(),
      ...(this.execution.lastEventAt === undefined
        ? {}
        : { lastEventAt: this.execution.lastEventAt }),
    };
  }
  start(): Promise<void> {
    if (this.starting) return this.starting;
    this.status = 'starting';
    this.starting = Promise.resolve().then(() => this.begin());
    return this.starting;
  }
  private async begin(): Promise<void> {
    try {
      await bounded(this.tokens.getToken(), Infinity, this.startup.signal, this.clock);
      this.startup.signal.throwIfAborted();
      this.execution.start();
      await bounded(this.transport.start(), Infinity, this.startup.signal, this.clock);
      this.startup.signal.throwIfAborted();
      this.status = 'running';
      this.changed();
    } catch (error) {
      if (!this.startup.signal.aborted) {
        this.status = 'failed';
        this.reporter.report(error, { phase: 'bootstrap', appId: this.config.appId });
        await this.stop(this.clock.monotonic() + this.config.execution.shutdownTimeoutMs).catch(
          (cleanup: unknown) =>
            this.reporter.report(cleanup, { phase: 'shutdown', appId: this.config.appId }),
        );
      }
      throw error;
    }
  }
  async fail(error: unknown, deadline: number): Promise<void> {
    if (this.status === 'failed') {
      await this.stop(deadline).catch(() => {});
      return;
    }
    this.status = 'failed';
    this.reporter.report(error, { phase: 'transport', appId: this.config.appId });
    try {
      await this.stop(deadline);
    } catch (cleanup) {
      this.reporter.report(cleanup, { phase: 'shutdown', appId: this.config.appId });
    }
  }
  stopAccepting(): void {
    if (this.status !== 'failed' && this.status !== 'stopped') this.status = 'stopping';
    this.execution.stopAccepting();
    this.tokens.suspend();
    this.http.beginDrain();
  }
  stop(deadline: number, drainApplication = false): Promise<void> {
    if (this.closing) return this.closing;
    const failed = this.status === 'failed';
    if (!failed) this.status = 'stopping';
    this.execution.stopAccepting();
    this.http.beginDrain();
    this.tokens.suspend();
    this.closing = Promise.resolve().then(() => this.cleanup(deadline, failed, drainApplication));
    this.startup.abort(new FrameworkError('INVALID_STATE', 'Bot is stopping'));
    this.changed();
    return this.closing;
  }
  private async cleanup(
    deadline: number,
    failed: boolean,
    drainApplication: boolean,
  ): Promise<void> {
    const errors: unknown[] = [];
    const settle = async (operation: () => Promise<void>) => {
      try {
        await bounded(Promise.resolve().then(operation), deadline, undefined, this.clock);
      } catch (error) {
        errors.push(error);
      }
    };
    const transport = settle(() => this.transport.stop(deadline));
    await settle(() => this.execution.idle(deadline));
    await settle(() =>
      this.outgoing.idle(deadline, drainApplication ? undefined : this.config.appId),
    );
    await settle(() => this.client.idleControls(deadline));
    await settle(() => this.http.drain(deadline));
    await transport;
    this.execution.abort();
    this.outgoing.abortAccount(this.config.appId);
    this.client.closeControls();
    this.tokens.close();
    this.http.close();
    this.dispatcher.resetBot(this.config.appId);
    this.reporter.close();
    this.status = failed ? 'failed' : 'stopped';
    this.changed();
    if (errors.length)
      throw new FrameworkError(
        errors.some((e) => e instanceof FrameworkError && e.code === 'SHUTDOWN_TIMEOUT')
          ? 'SHUTDOWN_TIMEOUT'
          : 'CLEANUP_FAILED',
        'Bot cleanup failed',
        { cause: new AggregateError(errors) },
      );
  }
}
