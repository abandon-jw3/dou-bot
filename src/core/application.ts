import { QQApi, QQClient } from '../contracts.js';
import type {
  ApplicationSnapshot,
  ApplicationStatus,
  BotApplication,
  BotOptions,
  InjectionToken,
  Type,
} from '../contracts.js';
import type { RequestListener } from 'node:http';
import { resolveOptions } from './config.js';
import type { ResolvedOptions } from './config.js';
import { ErrorReporter, LOGGER } from './logging.js';
import { Container } from './container.js';
import { Dispatcher } from './dispatcher.js';
import { COMMAND_CATALOG, CommandCatalog } from './help.js';
import { Execution } from './execution.js';
import { FrameworkError } from './errors.js';
import { bounded, throwIfAborted } from './utils.js';
import { HttpRuntime } from '../qq/http.js';
import type { FetchPort } from '../qq/http.js';
import { TokenManager } from '../qq/token.js';
import { HttpQQApi } from '../qq/api.js';
import { DefaultQQClient } from '../qq/client.js';
import { WebhookTransport } from '../transport/webhook.js';
import { WsTransport } from '../transport/ws.js';
import type { SocketFactory } from '../transport/ws.js';
import type { Transport } from '../transport/types.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';

export interface RuntimePorts {
  fetch?: FetchPort;
  transport?: () => Transport;
  random?: () => number;
  clock?: Clock;
  socketFactory?: SocketFactory;
}

export class Application implements BotApplication {
  private state: ApplicationStatus = 'created';
  readonly client: QQClient;
  readonly execution: Execution;
  private readonly config: ResolvedOptions;
  private readonly reporter: ErrorReporter;
  private readonly http: HttpRuntime;
  private readonly tokens: TokenManager;
  private readonly container: Container;
  private readonly dispatcher: Dispatcher;
  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly startup = new AbortController();
  private startPromise: Promise<void> | undefined;
  private closePromise: Promise<void> | undefined;
  private hooksPromise: Promise<void> | undefined;

  private constructor(root: Type, options: BotOptions, ports: RuntimePorts) {
    this.clock = ports.clock ?? systemClock;
    this.config = resolveOptions(options);
    this.reporter = new ErrorReporter(
      () => this.tokens?.sensitive() ?? [this.config.secret],
      this.config.onError,
      this.config.execution.errorHandlerTimeoutMs,
      this.config.logger,
      this.clock,
    );
    this.http = new HttpRuntime(this.config, ports.fetch, this.clock);
    this.tokens = new TokenManager(this.config, this.http, this.reporter, this.clock);
    const api = new HttpQQApi(this.config, this.http, this.tokens, this.clock);
    this.client = new DefaultQQClient(api, this.config, this.clock);
    const catalog = new CommandCatalog(this.config.prefix);
    const builtins = new Map<InjectionToken, unknown>([
      [QQClient, this.client],
      [QQApi, api],
      [LOGGER, this.reporter.logger],
      [COMMAND_CATALOG, catalog],
    ]);
    this.container = new Container(root, builtins, this.clock);
    const dispatcher = (this.dispatcher = new Dispatcher(
      this.container,
      this.config.prefix,
      this.config.invalidInput,
      catalog,
      {
        clock: this.clock,
        cooldownMaxEntries: this.config.execution.cooldownMaxEntries,
        acknowledge: this.config.acknowledge,
      },
    ));
    this.execution = new Execution(
      this.config,
      this.client,
      this.reporter,
      (task) => dispatcher.dispatch(task),
      (event) => dispatcher.handles(event),
      this.clock,
    );
    this.http.managed = (signal) =>
      signal !== undefined && this.execution.managedSignals.has(signal);
    this.transport =
      ports.transport?.() ??
      (this.config.transport.type === 'webhook'
        ? new WebhookTransport(this.config, this.execution, this.reporter, this.clock)
        : new WsTransport(
            this.config,
            api,
            this.tokens,
            this.execution,
            this.reporter,
            (status) => {
              if (this.state === 'running' || this.state === 'reconnecting') this.state = status;
            },
            ports.random,
            this.clock,
            ports.socketFactory,
          ));
  }

  static async create(
    root: Type,
    options: BotOptions,
    ports: RuntimePorts = {},
  ): Promise<Application> {
    const app = new Application(root, options, ports);
    try {
      await app.container.initialize();
      app.dispatcher.validateGuards();
      return app;
    } catch (error) {
      app.state = 'failed';
      await app.close().catch(() => {});
      throw error;
    }
  }
  get status(): ApplicationStatus {
    return this.state;
  }
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T {
    return this.container.get(token, options?.module);
  }
  webhookHandler(): RequestListener {
    if (this.config.transport.type !== 'webhook' || !this.transport.handler)
      throw new FrameworkError('INVALID_STATE', 'This application has no Webhook handler');
    return this.transport.handler;
  }
  snapshot(): ApplicationSnapshot {
    return {
      status: this.state,
      transport: this.config.transport.type,
      queue: this.execution.snapshot(),
      events: { ...this.execution.events },
      ...(this.execution.lastEventAt === undefined
        ? {}
        : { lastEventAt: this.execution.lastEventAt }),
    };
  }
  start(): Promise<void> {
    if (['stopping', 'stopped', 'failed'].includes(this.state))
      return Promise.reject(new FrameworkError('INVALID_STATE', 'Application cannot be restarted'));
    if (this.startPromise) return this.startPromise;
    this.state = 'starting';
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.startPromise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.begin().then(resolve, reject);
    return this.startPromise;
  }
  private async begin(): Promise<void> {
    try {
      // Install the hook promise before a hook can reenter start() or close().
      this.hooksPromise = Promise.resolve().then(() =>
        this.container.callInitHooks(this.startup.signal),
      );
      await bounded(this.hooksPromise, Infinity, this.startup.signal, this.clock);
      await bounded(this.tokens.getToken(), Infinity, this.startup.signal, this.clock);
      throwIfAborted(this.startup.signal);
      this.execution.start();
      await bounded(this.transport.start(), Infinity, this.startup.signal, this.clock);
      throwIfAborted(this.startup.signal);
      this.state = 'running';
    } catch (error) {
      if (this.startup.signal.aborted)
        throw new FrameworkError('INVALID_STATE', 'Application stopped during startup');
      this.state = 'failed';
      this.reporter.report(error, { phase: 'bootstrap', appId: this.config.appId });
      await this.close().catch((cleanupError: unknown) =>
        this.reporter.report(cleanupError, { phase: 'shutdown', appId: this.config.appId }),
      );
      throw error;
    }
  }
  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const failed = this.state === 'failed';
    if (!failed) this.state = 'stopping';
    const deadline = this.clock.monotonic() + this.config.execution.shutdownTimeoutMs;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    this.closePromise = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    this.execution.stopAccepting();
    this.tokens.suspend();
    this.http.beginDrain();
    this.startup.abort(new FrameworkError('INVALID_STATE', 'Application is stopping'));
    this.cleanup(failed, deadline).then(resolve, reject);
    return this.closePromise;
  }
  private async cleanup(failed: boolean, deadline: number): Promise<void> {
    const errors: unknown[] = [];
    const settle = async (promise: Promise<void>) => {
      try {
        await bounded(promise, deadline, undefined, this.clock);
      } catch (error) {
        errors.push(error);
      }
    };
    const stopped = settle(this.transport.stop(deadline));
    if (this.hooksPromise)
      await settle(
        this.hooksPromise.then(
          () => {},
          () => {},
        ),
      );
    await settle(this.execution.idle(deadline));
    await settle(this.http.drain(deadline));
    await stopped;
    this.execution.abort();
    this.dispatcher.close();
    this.tokens.close();
    this.http.close();
    await settle(this.container.destroy(deadline));
    this.reporter.close();
    this.state = failed ? 'failed' : 'stopped';
    if (errors.length) {
      const timeout = errors.some(
        (error) => error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT',
      );
      throw new FrameworkError(
        timeout ? 'SHUTDOWN_TIMEOUT' : 'CLEANUP_FAILED',
        'Application cleanup did not finish cleanly',
        { cause: new AggregateError(errors) },
      );
    }
  }
}
