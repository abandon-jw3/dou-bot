import type { AppOptions, BotOptions } from '../contracts.js';
import type { TestApplication } from './contracts.js';
export type { TestApplication } from './contracts.js';
import type { BotSnapshot, BotStatus, InjectionToken, Type } from '../contracts.js';
import type { RequestListener } from 'node:http';
import { Application } from '../core/application.js';
import type { RuntimePorts } from '../core/application.js';
import type { SingleBotOptions } from '../core/single-options.js';
import { MemoryPersistence } from './memory-persistence.js';

/** Single-account view of the same application runtime, used only by offline/regression fixtures. */
export class SingleTestApplication implements TestApplication {
  private constructor(
    readonly application: Application,
    readonly appId: string,
  ) {}
  static async create(
    root: Type,
    options: SingleBotOptions & Pick<AppOptions, 'outbound' | 'diagnostics'>,
    ports: RuntimePorts = {},
  ): Promise<SingleTestApplication> {
    const { appId, secret, transport, api, interactions, ...shared } = options;
    const webhook =
      transport?.type === 'webhook'
        ? {
            listen: transport.listen ?? true,
            ...(transport.host === undefined ? {} : { host: transport.host }),
            ...(transport.port === undefined ? {} : { port: transport.port }),
          }
        : undefined;
    const protocol = transport && { ...transport };
    if (protocol?.type === 'webhook') {
      delete protocol.listen;
      delete protocol.host;
      delete protocol.port;
      protocol.path ??= '/qq';
    }
    const application = await Application.create(
      root,
      {
        ...shared,
        database: { host: '127.0.0.1', user: 'offline', password: '', database: 'offline' },
        bots: [
          {
            appId,
            secret,
            ...(protocol ? { transport: protocol as NonNullable<BotOptions['transport']> } : {}),
            ...(api ? { api } : {}),
            ...(interactions ? { interactions } : {}),
          },
        ],
        ...(webhook ? { webhook } : {}),
      },
      { ...ports, persistence: ports.persistence ?? new MemoryPersistence() },
    );
    try {
      await application.initialize();
    } catch (error) {
      await application.close().catch(() => {});
      throw error;
    }
    return new SingleTestApplication(application, appId);
  }
  get runtime() {
    return this.application.runtime(this.appId);
  }
  get diagnostics() {
    return this.application.diagnostics;
  }
  get execution() {
    return this.runtime.execution;
  }
  get dispatcher() {
    return this.application.dispatcher;
  }
  get http() {
    return this.runtime.http;
  }
  get tokens() {
    return this.runtime.tokens;
  }
  get transport() {
    return this.runtime.transport;
  }
  get client() {
    return this.application.bots.get(this.appId).client;
  }
  get status(): BotStatus {
    return this.application.status === 'failed'
      ? 'failed'
      : this.application.status === 'created'
        ? 'created'
        : this.runtime.status;
  }
  start(): Promise<void> {
    return this.application.start();
  }
  close(): Promise<void> {
    return this.application.close();
  }
  get<T>(token: InjectionToken<T>, options?: { module?: Type }): T {
    return this.application.get(token, options);
  }
  webhookHandler(): RequestListener {
    return this.application.webhookHandler();
  }
  snapshot(): BotSnapshot {
    return { ...this.runtime.snapshot(), status: this.status };
  }
}

export type { RuntimePorts } from '../core/application.js';
