import type {
  Awaitable,
  ContextKey,
  ContextMiddleware,
  ContextOptions,
  ContextReader,
  ContextWriter,
  GuardContext,
} from '../contracts.js';
import { errorOf, FrameworkError } from './errors.js';
import type { Clock } from './clock.js';
import { bounded, callable, hasControlCharacters, isObject } from './utils.js';

const names = new WeakMap<object, string>();

export function createContextKey<T>(name: string): ContextKey<T> {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    hasControlCharacters(name) ||
    /[\u2028\u2029]/u.test(name)
  )
    throw new FrameworkError('CONFIG', 'Context key name must be a nonempty single-line string');
  const key = Object.freeze({});
  names.set(key, name);
  return key as ContextKey<T>;
}

export function assertContextKey(
  key: unknown,
  code: 'CONFIG' | 'HANDLER_CONTRACT' = 'HANDLER_CONTRACT',
): asserts key is ContextKey<unknown> {
  if (!isObject(key) || !names.has(key))
    throw new FrameworkError(code, 'Context keys must be created by createContextKey');
}

export function assertMiddleware(value: unknown): asserts value is ContextMiddleware {
  if (!isObject(value) || !callable(Reflect.get(value, 'prepare')))
    throw new FrameworkError('HANDLER_CONTRACT', 'Middleware provider must implement prepare()');
}

interface Entry {
  loader?: (signal: AbortSignal) => Awaitable<unknown>;
  promise?: Promise<unknown>;
}
interface StatePorts {
  signal: AbortSignal;
  clock: Clock;
  managedSignals?: Set<AbortSignal>;
  track<T>(operation: () => Promise<T>): Promise<T>;
  report(error: Error): void;
}

/** One handler owns the map; only the currently executing prepare call can register data. */
export class ContextState {
  readonly reader: ContextReader;
  private readonly entries = new Map<object, Entry>();
  private readonly operations = new Set<AbortController>();
  private sealed = false;
  private readonly abort = () => this.close();

  constructor(
    private readonly options: Readonly<Required<ContextOptions>>,
    private readonly ports: StatePorts,
  ) {
    this.reader = Object.freeze({ get: <T>(key: ContextKey<T>) => this.get(key) });
    ports.signal.addEventListener('abort', this.abort, { once: true });
    if (ports.signal.aborted) this.close();
  }

  private assertOpen(): void {
    if (this.sealed || this.ports.signal.aborted)
      throw new FrameworkError('INVALID_STATE', 'Context data scope has finished');
  }

  private register(key: unknown, entry: Entry): void {
    this.assertOpen();
    assertContextKey(key);
    if (this.entries.has(key))
      throw new FrameworkError(
        'HANDLER_CONTRACT',
        `Context key already registered: ${names.get(key)}`,
      );
    if (this.entries.size >= this.options.maxEntries)
      throw new FrameworkError('RESOURCE_LIMIT', 'Too many registered context keys');
    this.entries.set(key, entry);
  }

  private get<T>(key: ContextKey<T>): Promise<T> {
    try {
      this.assertOpen();
      assertContextKey(key);
      const entry = this.entries.get(key);
      if (!entry)
        throw new FrameworkError(
          'HANDLER_CONTRACT',
          `Context key is not registered: ${names.get(key)}`,
        );
      if (!entry.promise) {
        const loader = entry.loader!;
        delete entry.loader;
        // timed defers invocation, so recursive/concurrent reads see the cached Promise first.
        entry.promise = this.ports.track(() =>
          this.timed(this.options.loadTimeoutMs, `Context loader ${names.get(key)}`, (signal) =>
            loader(signal()),
          ),
        );
      }
      return entry.promise as Promise<T>;
    } catch (cause) {
      const error = errorOf(cause);
      this.ports.report(error);
      const rejected = Promise.reject<T>(error);
      void rejected.catch(() => {});
      return rejected;
    }
  }

  async prepare(middleware: ContextMiddleware, context: GuardContext): Promise<void> {
    this.assertOpen();
    assertMiddleware(middleware);
    let writable = true;
    const assertWritable = () => {
      this.assertOpen();
      if (!writable)
        throw new FrameworkError('INVALID_STATE', 'Middleware preparation has finished');
    };
    const writer: ContextWriter = Object.freeze({
      get: <T>(key: ContextKey<T>) => this.get(key),
      set: <T>(key: ContextKey<T>, value: T): void => {
        // Observe a rejected Promise even though set deliberately rejects async values.
        const asynchronous = isObject(value) && callable(Reflect.get(value, 'then'));
        if (asynchronous) void Promise.resolve(value).catch(() => {});
        assertWritable();
        if (asynchronous) {
          throw new FrameworkError(
            'HANDLER_CONTRACT',
            'Context set requires a completed value; use provide',
          );
        }
        this.register(key, { promise: Promise.resolve(value) });
      },
      provide: <T>(key: ContextKey<T>, loader: (signal: AbortSignal) => Awaitable<T>): void => {
        assertWritable();
        if (typeof loader !== 'function')
          throw new FrameworkError('HANDLER_CONTRACT', 'Context loader must be a function');
        this.register(key, { loader });
      },
    });
    try {
      const result: unknown = await this.timed(
        this.options.prepareTimeoutMs,
        'Middleware prepare',
        (signal) =>
          middleware.prepare(
            Object.freeze({
              ...context,
              state: writer,
              get signal() {
                return signal();
              },
            }),
          ),
        () => {
          writable = false;
        },
        false,
      );
      if (result !== undefined)
        throw new FrameworkError('HANDLER_CONTRACT', 'Middleware prepare must return void');
    } finally {
      writable = false;
    }
  }

  private async timed<T>(
    timeout: number,
    label: string,
    operation: (signal: () => AbortSignal) => Awaitable<T>,
    finish?: () => void,
    deferStart = true,
  ): Promise<T> {
    this.assertOpen();
    let controller: AbortController | undefined;
    let finished = false;
    let failure: { reason: unknown } | undefined;
    const signal = () => {
      if (!controller) {
        controller = new AbortController();
        if (finished) {
          controller.abort(
            failure
              ? failure.reason
              : new FrameworkError('INVALID_STATE', 'Context operation has finished'),
          );
        } else if (this.ports.signal.aborted) {
          controller.abort(this.ports.signal.reason);
        } else {
          this.operations.add(controller);
          this.ports.managedSignals?.add(controller.signal);
        }
      }
      return controller.signal;
    };
    const deadline = this.ports.clock.monotonic() + timeout;
    const timeoutError = () => new FrameworkError('CONTEXT_TIMEOUT', `${label} timed out`);
    try {
      const run = () => {
        this.ports.signal.throwIfAborted();
        if (this.ports.clock.monotonic() >= deadline) throw timeoutError();
        return operation(signal);
      };
      // prepare does not need the lazy-loader cache barrier. A synchronous void result
      // can finish without scheduling a timer or allocating a Promise race.
      let pending: Promise<T>;
      if (deferStart) pending = Promise.resolve().then(run);
      else {
        const value = run();
        if (value === undefined) {
          if (this.ports.clock.monotonic() >= deadline) throw timeoutError();
          return value;
        }
        pending = Promise.resolve(value);
      }
      return await bounded(pending, deadline, signal(), this.ports.clock, timeoutError);
    } catch (error) {
      failure = { reason: error };
      finish?.();
      controller?.abort(error);
      throw error;
    } finally {
      finish?.();
      finished = true;
      if (controller) {
        this.operations.delete(controller);
        this.ports.managedSignals?.delete(controller.signal);
        if (!controller.signal.aborted)
          controller.abort(new FrameworkError('INVALID_STATE', 'Context operation has finished'));
      }
    }
  }

  /** Stop new reads immediately; already tracked loads still drain under their own deadlines. */
  seal(): void {
    this.sealed = true;
    this.entries.clear();
  }
  close(): void {
    this.seal();
    this.ports.signal.removeEventListener('abort', this.abort);
    for (const operation of this.operations)
      operation.abort(
        this.ports.signal.reason ??
          new FrameworkError('INVALID_STATE', 'Context data scope has finished'),
      );
    this.operations.clear();
  }
}
