import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { record } from './common.js';

export type Message = Record<string, unknown>;

/** A bounded mailbox shared by local IPC workers and remote framed channels. */
export class Mailbox {
  private readonly queued: Message[] = [];
  private readonly waiters = new Set<{
    predicate(message: Message): boolean;
    resolve(message: Message): void;
    reject(error: Error): void;
  }>();
  private error?: Error;
  onMessage?: (message: Message) => boolean;
  deliver(message: unknown): void {
    if (this.error || !record(message)) return;
    try {
      if (this.onMessage?.(message)) return;
      for (const waiter of this.waiters) {
        if (!waiter.predicate(message)) continue;
        this.waiters.delete(waiter);
        waiter.resolve(message);
        return;
      }
      if (this.queued.length >= 128) throw new Error('Benchmark control mailbox overflow');
      this.queued.push(message);
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }
  fail(error: Error): void {
    this.error ??= error;
    for (const waiter of this.waiters) waiter.reject(this.error);
    this.waiters.clear();
  }
  wait(type: string, timeoutMs = 20000, nonce?: string): Promise<Message> {
    const predicate = (message: Message) =>
      message.type === type && (nonce === undefined || message.nonce === nonce);
    const index = this.queued.findIndex(predicate);
    if (index >= 0) return Promise.resolve(this.queued.splice(index, 1)[0]!);
    if (this.error) return Promise.reject(this.error);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      const waiter = {
        predicate,
        resolve: (message: Message) => {
          clearTimeout(timer);
          resolve(message);
        },
        reject: (error: Error) => {
          clearTimeout(timer);
          reject(error);
        },
      };
      this.waiters.add(waiter);
    });
  }
}

export class Worker extends Mailbox {
  readonly child: ChildProcess;
  readonly exited: Promise<void>;
  private ended = false;
  private stopping?: Promise<void>;
  constructor(
    args: string[],
    entry = fileURLToPath(new URL('../benchmark-mixed.js', import.meta.url)),
  ) {
    super();
    this.child = fork(entry, args, {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      execArgv: ['--expose-gc'],
    });
    this.child.on('message', (message: unknown) => this.deliver(message));
    this.child.on('error', (error) => this.fail(error));
    this.exited = new Promise((resolve) =>
      this.child.once('close', (code, signal) => {
        this.ended = true;
        this.fail(new Error(`Worker ${args[0]} exited ${code ?? signal}`));
        resolve();
      }),
    );
  }
  send(message: Message): void {
    if (this.child.connected)
      this.child.send(message, (error: Error | null) => {
        if (error) this.fail(error);
      });
  }
  stop(): Promise<void> {
    this.stopping ??= (async () => {
      if (this.ended) return;
      if (this.child.connected) this.child.disconnect();
      const force = setTimeout(() => this.child.kill('SIGKILL'), 12000);
      await this.exited;
      clearTimeout(force);
    })();
    return this.stopping;
  }
}
