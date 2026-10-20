import { MessageSender } from '../contracts.js';
import type {
  GroupRoutes,
  MessageInput,
  SendOptions,
  SendResult,
  SendTarget,
} from '../contracts.js';
import type { BotRuntime } from './bot-runtime.js';
import type { OutboundQueue } from './outbound.js';
import { addressId } from './group-routes.js';
import { bounded, isRecord } from './utils.js';
import { errorOf, FrameworkError } from './errors.js';
import { messageBytes } from '../qq/managed-client.js';
import { snapshotMessage } from '../message/index.js';
import type { Diagnostics } from '../diagnostics/observer.js';

export class Sender extends MessageSender {
  private readonly unresolved = Symbol('unresolved route');
  constructor(
    private readonly routes: GroupRoutes,
    private readonly queue: OutboundQueue,
    private readonly runtime: (appId: string) => BotRuntime,
    private readonly available: () => boolean,
    private readonly report: (error: unknown, appId?: string, sourceAppId?: string) => void,
    private readonly sourceAccount: (signal?: AbortSignal) => string | undefined,
    private readonly maxUpload: number,
    private readonly observer?: Diagnostics,
  ) {
    super();
  }
  override sendMessage(
    target: SendTarget,
    input: MessageInput,
    options: SendOptions = {},
  ): Promise<SendResult> {
    let operation: Promise<SendResult>;
    let destination: string | undefined;
    let source: string | undefined;
    try {
      if (!this.available())
        throw new FrameworkError('INVALID_STATE', 'Application does not accept background sends');
      if (!isRecord(target) || !isRecord(options))
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid send target or options');
      const copied = { ...target };
      destination = copied.appId;
      source = this.sourceAccount(
        options.signal instanceof AbortSignal ? options.signal : undefined,
      );
      const message = snapshotMessage(input, this.maxUpload);
      const send: SendOptions = {
        ...options,
        ...(options.reply
          ? { reply: { ...(options.reply as NonNullable<SendOptions['reply']>) } }
          : {}),
      };
      if (copied.scene === 'group') addressId(copied.groupId);
      else if (copied.scene === 'private') addressId(copied.userId);
      else throw new FrameworkError('HANDLER_CONTRACT', 'Unknown target scene');
      if (copied.appId !== undefined) addressId(copied.appId);
      else if (copied.scene !== 'group')
        throw new FrameworkError('HANDLER_CONTRACT', 'Private sending requires appId');
      // Route lookups occupy a bounded outbound job too; no unbounded PostgreSQL wait queue.
      operation = this.queue.run(
        copied.appId ?? this.unresolved,
        messageBytes(message),
        async (signal) => {
          let address = copied;
          if (copied.appId === undefined && copied.scene === 'group') {
            const lookup = this.observer?.start(
              'route.lookup',
              this.observer.context(signal),
              signal,
            );
            try {
              address = await bounded(this.routes.resolve(copied.groupId), Infinity, signal);
            } catch (error) {
              lookup?.fail(error, signal);
              throw error;
            } finally {
              lookup?.end();
            }
          }
          signal.throwIfAborted();
          if (!address.appId) throw new FrameworkError('ROUTE_NOT_FOUND', 'No bot address');
          destination = address.appId;
          return this.runtime(address.appId).sendAdmitted(address, message, { ...send, signal });
        },
        send.signal,
      );
    } catch (error) {
      operation = Promise.reject(errorOf(error));
    }
    operation.catch((error: unknown) => this.report(error, destination, source));
    return operation;
  }
}
