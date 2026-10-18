import { Manager, Handle } from './bot-manager.js';
import { Sender } from './message-sender.js';
import { createServer } from 'node:http';
import type { RequestListener, Server } from 'node:http';
import { BotManager, Database, GroupRoutes, MessageSender } from '../contracts.js';
import type {
  Application as ApplicationContract,
  ApplicationSnapshot,
  ApplicationStatus,
  AppOptions,
  InjectionToken,
  Type,
} from '../contracts.js';
import { resolveApplication } from './runtime-config.js';
import type { ApplicationSettings } from './runtime-config.js';
import { ErrorReporter, LOGGER } from './logging.js';
import { Container } from './container.js';
import { Dispatcher } from './dispatcher.js';
import { COMMAND_CATALOG, CommandCatalog } from './help.js';
import { errorOf, FrameworkError } from './errors.js';
import { bounded } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import { PostgresDatabase } from '../database/postgres.js';
import type { Persistence } from '../database/postgres.js';
import { PersistentGroupRoutes } from './group-routes.js';
import { ExecutionPool } from './execution-pool.js';
import { OutboundQueue } from './outbound.js';
import { BotRuntime } from './bot-runtime.js';
import type { AccountPorts } from './bot-runtime.js';

/** Private ports are used by local protocol tests, never part of the public declaration graph. */
export interface RuntimePorts extends AccountPorts {
  clock?: Clock;
  accounts?: (appId: string) => AccountPorts;
  persistence?: Persistence;
}
export class Application implements ApplicationContract {
  private state: ApplicationStatus = 'created';
  readonly bots: BotManager;
  readonly container: Container;
  readonly dispatcher: Dispatcher;
  readonly config: ApplicationSettings;
  readonly incoming: ExecutionPool;
  readonly outgoing: OutboundQueue;
  readonly store: Persistence;
  private readonly routes: PersistentGroupRoutes;
  private readonly handles = new Map<string, Handle>();
  private readonly reporter: ErrorReporter;
  private readonly clock: Clock;
  private readonly startup = new AbortController();
  private server: Server | undefined;
  private listenerStart: Promise<void> | undefined;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private initialized?: Promise<void>;
  private hooks?: Promise<void>;
  private databaseReady = false;
  private constructor(root: Type, options: AppOptions, ports: RuntimePorts) {
    this.clock = ports.clock ?? systemClock;
    this.config = resolveApplication(options);
    const shared = this.config.shared;
    const sensitive = () =>
      [
        this.config.database.password,
        ...this.config.bots.flatMap((config) => [config.secret]),
        ...this.handles.values(),
      ].flatMap((value) =>
        typeof value === 'string' ? [value] : value.runtime.tokens.sensitive(),
      );
    this.reporter = new ErrorReporter(
      sensitive,
      shared.onError,
      shared.execution.errorHandlerTimeoutMs,
      shared.logger,
      this.clock,
    );
    this.store =
      ports.persistence ??
      new PostgresDatabase(
        this.config.database,
        (error) => this.reporter.report(error, { phase: 'database' }),
        this.clock,
      );
    this.routes = new PersistentGroupRoutes(
      this.store,
      new Set(this.config.bots.map((bot) => bot.appId)),
      () => this.databaseReady && this.state !== 'stopped' && this.state !== 'failed',
    );
    this.incoming = new ExecutionPool(shared.execution);
    this.outgoing = new OutboundQueue(this.config.outbound, this.clock);
    this.bots = new Manager(this.handles);
    const sender = new Sender(
      this.routes,
      this.outgoing,
      (appId) => this.runtime(appId),
      () => this.state === 'running' || this.state === 'degraded',
      (error, appId, sourceAppId) =>
        this.reporter.report(error, {
          phase: 'send',
          ...(appId === undefined ? {} : { appId }),
          ...(sourceAppId === undefined ? {} : { sourceAppId }),
        }),
      (signal) =>
        signal === undefined
          ? undefined
          : [...this.handles.values()].find((handle) =>
              handle.runtime.execution.managedSignals.has(signal),
            )?.appId,
      Math.max(...this.config.bots.map((bot) => bot.api.maxUploadBytes)),
    );
    const catalog = new CommandCatalog(shared.prefix);
    this.container = new Container(
      root,
      new Map<InjectionToken, unknown>([
        [BotManager, this.bots],
        [MessageSender, sender],
        [Database, this.store.database],
        [GroupRoutes, this.routes],
        [LOGGER, this.reporter.logger],
        [COMMAND_CATALOG, catalog],
      ]),
      this.clock,
    );
    this.dispatcher = new Dispatcher(this.container, shared.prefix, shared.invalidInput, catalog, {
      clock: this.clock,
      cooldownMaxEntries: shared.execution.cooldownMaxEntries,
      acknowledge: (appId) => this.handles.get(appId)?.runtime.config.acknowledge ?? 'auto',
    });
    for (const config of this.config.bots)
      this.handles.set(
        config.appId,
        new Handle(
          config.appId,
          () =>
            new BotRuntime(
              config,
              this.dispatcher,
              this.routes,
              this.outgoing,
              this.incoming,
              this.clock,
              () => this.refreshStatus(),
              ports.accounts?.(config.appId) ?? ports,
              sensitive,
              () => this.state === 'running' || this.state === 'degraded',
            ),
          () => this.resumeBot(config.appId),
          () => this.deadline(),
          this.startup.signal,
        ),
      );
  }
  static create(root: Type, options: AppOptions, ports: RuntimePorts = {}): Promise<Application> {
    try {
      return Promise.resolve(new Application(root, options, ports));
    } catch (error) {
      return Promise.reject(errorOf(error));
    }
  }
  get status(): ApplicationStatus {
    return this.state;
  }
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T {
    return this.container.get(token, options?.module);
  }
  /** Internal access for protocol fixtures; public clients use app.bots.get(appId). */
  runtime(appId: string): BotRuntime {
    const handle = this.handles.get(appId);
    if (!handle) throw new FrameworkError('BOT_UNAVAILABLE', 'Unknown bot');
    return handle.runtime;
  }
  private async resumeBot(appId: string): Promise<void> {
    if (this.state !== 'running' && this.state !== 'degraded')
      throw new FrameworkError('INVALID_STATE', 'Application is not running');
    const handle = this.handles.get(appId)!;
    await handle.begin();
    if (handle.runtime.config.transport.type === 'webhook' && this.config.webhook.listen) {
      try {
        await this.listen();
      } catch (error) {
        await handle.runtime.fail(error, this.deadline());
        throw error;
      }
    }
    this.refreshStatus();
  }
  private deadline(): number {
    return this.clock.monotonic() + this.config.shared.execution.shutdownTimeoutMs;
  }
  private refreshStatus(): void {
    if (this.state !== 'running' && this.state !== 'degraded') return;
    this.state = [...this.handles.values()].every((handle) => handle.status === 'running')
      ? 'running'
      : 'degraded';
  }
  async initialize(): Promise<void> {
    this.initialized ??= (async () => {
      await this.store.open();
      this.startup.signal.throwIfAborted();
      this.databaseReady = true;
      await this.store.registerBots(this.config.bots.map((bot) => bot.appId));
      this.startup.signal.throwIfAborted();
      await this.container.initialize();
      this.dispatcher.validateControls();
    })();
    return this.initialized;
  }
  start(): Promise<void> {
    if (['stopping', 'stopped', 'failed'].includes(this.state))
      return Promise.reject(new FrameworkError('INVALID_STATE', 'Application cannot be restarted'));
    if (this.startPromise) return this.startPromise;
    this.state = 'starting';
    this.startPromise = Promise.resolve().then(() => this.begin());
    return this.startPromise;
  }
  private async begin(): Promise<void> {
    try {
      await bounded(this.initialize(), Infinity, this.startup.signal, this.clock);
      this.hooks = Promise.resolve().then(() => this.container.callInitHooks(this.startup.signal));
      await bounded(this.hooks, Infinity, this.startup.signal, this.clock);
      const starts = await Promise.allSettled(
        [...this.handles.values()].map((handle) => handle.begin()),
      );
      this.startup.signal.throwIfAborted();
      if (starts.every((result) => result.status === 'rejected'))
        throw new FrameworkError('BOT_UNAVAILABLE', 'All configured bots failed to start', {
          cause: new AggregateError(
            starts.filter((r) => r.status === 'rejected').map((r) => r.reason as unknown),
          ),
        });
      if (
        this.config.bots.some((bot) => bot.transport.type === 'webhook') &&
        this.config.webhook.listen
      ) {
        try {
          await this.listen();
        } catch (error) {
          if (this.startup.signal.aborted) throw error;
          await Promise.all(
            [...this.handles.values()]
              .filter((handle) => handle.runtime.config.transport.type === 'webhook')
              .map((handle) => handle.runtime.fail(error, this.deadline())),
          );
          if (
            ![...this.handles.values()].some(
              (handle) => handle.status === 'running' || handle.status === 'reconnecting',
            )
          )
            throw error;
        }
      }
      this.startup.signal.throwIfAborted();
      this.state = 'running';
      this.refreshStatus();
      this.hooks = Promise.resolve().then(() =>
        this.container.callApplicationHooks('onApplicationReady', this.startup.signal),
      );
      await bounded(this.hooks, Infinity, this.startup.signal, this.clock);
    } catch (error) {
      if (this.startup.signal.aborted)
        throw new FrameworkError('INVALID_STATE', 'Application stopped during startup');
      this.state = 'failed';
      this.reporter.report(error, { phase: 'bootstrap' });
      await this.close().catch((cleanup: unknown) =>
        this.reporter.report(cleanup, { phase: 'shutdown' }),
      );
      throw error;
    }
  }
  webhookHandler(): RequestListener {
    if (!this.config.bots.some((bot) => bot.transport.type === 'webhook'))
      throw new FrameworkError('INVALID_STATE', 'No Webhook bots configured');
    const routes = new Map(
      this.config.bots
        .filter((bot) => bot.transport.type === 'webhook')
        .map((bot) => [bot.transport.type === 'webhook' ? bot.transport.path : '', bot.appId]),
    );
    return (request, response) => {
      const appId = routes.get(request.url?.split('?')[0] ?? '');
      const handler =
        appId === undefined ? undefined : this.handles.get(appId)?.runtime.webhookHandler();
      if (!handler) {
        response.writeHead(404, { connection: 'close' });
        response.end();
        return;
      }
      if (this.state !== 'running' && this.state !== 'degraded') {
        response.writeHead(503, { connection: 'close' });
        response.end();
        return;
      }
      handler(request, response);
    };
  }
  private listen(): Promise<void> {
    if (this.server?.listening) return Promise.resolve();
    this.listenerStart ??= Promise.resolve()
      .then(() => this.openListener())
      .finally(() => {
        this.listenerStart = undefined;
      });
    return this.listenerStart;
  }
  private async openListener(): Promise<void> {
    this.startup.signal.throwIfAborted();
    const server = createServer(this.webhookHandler());
    this.server = server;
    try {
      await bounded(
        new Promise<void>((resolve, reject) => {
          server.once('error', reject);
          server.listen(this.config.webhook.port, this.config.webhook.host, () => {
            server.off('error', reject);
            if (this.startup.signal.aborted) {
              server.close(() => {});
              reject(errorOf(this.startup.signal.reason));
            } else resolve();
          });
        }),
        Infinity,
        this.startup.signal,
        this.clock,
      );
    } catch (error) {
      server.closeAllConnections();
      server.close(() => {});
      if (this.server === server) this.server = undefined;
      throw error;
    }
    server.on('error', () =>
      this.reporter.report(new FrameworkError('TRANSPORT', 'Shared Webhook listener failed'), {
        phase: 'transport',
      }),
    );
  }
  snapshot(): ApplicationSnapshot {
    const pool = this.store.database.pool;
    return Object.freeze({
      status: this.state,
      bots: Object.freeze(
        [...this.handles.values()].map((handle) =>
          Object.freeze({ appId: handle.appId, ...handle.snapshot() }),
        ),
      ),
      inbound: Object.freeze(this.incoming.snapshot()),
      outbound: this.outgoing.snapshot(),
      database: Object.freeze({
        total: pool.totalCount,
        idle: pool.idleCount,
        waiting: pool.waitingCount,
      }),
    });
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const failed = this.state === 'failed';
    const deadline = this.deadline();
    if (!failed) this.state = 'stopping';
    this.closePromise = Promise.resolve().then(() => this.cleanup(deadline, failed));
    for (const handle of this.handles.values()) handle.runtime.stopAccepting();
    this.startup.abort(new FrameworkError('INVALID_STATE', 'Application is stopping'));
    return this.closePromise;
  }
  private async cleanup(deadline: number, failed: boolean): Promise<void> {
    const errors: unknown[] = [];
    const settle = async (operation: () => Promise<void>) => {
      try {
        await bounded(Promise.resolve().then(operation), deadline, undefined, this.clock);
      } catch (error) {
        errors.push(error);
      }
    };
    const controller = new AbortController();
    const timer = this.clock.timeout(
      () => controller.abort(new FrameworkError('SHUTDOWN_TIMEOUT', 'Shutdown deadline exceeded')),
      Math.max(1, deadline - this.clock.monotonic()),
    );
    if (this.initialized) await settle(() => this.initialized!.catch(() => {}));
    if (this.hooks) await settle(() => this.hooks!.catch(() => {}));
    await settle(() =>
      this.container.callApplicationHooks('onApplicationStopping', controller.signal),
    );
    const server = this.server;
    const listener = server
      ? settle(
          () =>
            new Promise<void>((resolve, reject) => {
              server.close((error) =>
                error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
                  ? reject(error)
                  : resolve(),
              );
              server.closeIdleConnections();
            }),
        )
      : Promise.resolve();
    const stopped = await Promise.allSettled(
      [...this.handles.values()].map((handle) => handle.runtime.stop(deadline, true)),
    );
    for (const result of stopped) if (result.status === 'rejected') errors.push(result.reason);
    this.outgoing.close();
    this.dispatcher.close();
    await listener;
    server?.closeAllConnections();
    await this.container.destroy(deadline).catch((error: unknown) => errors.push(error));
    this.routes.clear();
    this.databaseReady = false;
    await this.store.close(deadline).catch((error: unknown) => errors.push(error));
    timer.cancel();
    this.reporter.close();
    this.state = failed ? 'failed' : 'stopped';
    if (errors.length)
      throw new FrameworkError(
        errors.some((e) => e instanceof FrameworkError && e.code === 'SHUTDOWN_TIMEOUT')
          ? 'SHUTDOWN_TIMEOUT'
          : 'CLEANUP_FAILED',
        'Application cleanup did not finish cleanly',
        { cause: new AggregateError(errors) },
      );
  }
}
