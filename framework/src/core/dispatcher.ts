import type { ControllerBinding, Container } from './container.js';
import type { HandlerMetadata, ParameterBinding } from './metadata.js';
import { readHandlers } from './metadata.js';
import { FrameworkError } from './errors.js';
import { callable } from './utils.js';
import { tokenizeCommand } from './parser.js';
import { AttachmentRoute } from './attachment-route.js';
import { CommandArguments } from './arguments.js';
import { CommandInputError } from './input-error.js';
import { bindIdentity } from './identity.js';
import { assertMiddleware } from './context-state.js';
import { CommandCatalog } from './help.js';
import { CooldownStore } from './cooldown.js';
import { assertGuard, guardContext, runGuard } from './guards.js';
import { createBuiltinGuard, isBuiltinGuard } from './access.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';
import type { EventTask, HandlerLocation } from './event-task.js';
import type {
  Attachment,
  CanActivate,
  ContextMiddleware,
  ErrorPhase,
  MessageInput,
} from '../contracts.js';
import type { NormalizedEvent } from '../qq/normalize.js';
import type { Observation } from '../diagnostics/observer.js';
import { diagnosticOutcome } from '../diagnostics/observer.js';
import type { DiagnosticsOutcome } from '../diagnostics/contracts.js';

interface Route {
  binding: ControllerBinding;
  metadata: HandlerMetadata;
  arguments?: CommandArguments;
  attachment?: AttachmentRoute;
  id: number;
  guards: readonly (() => CanActivate)[];
  middlewares: readonly (() => ContextMiddleware)[];
  needsContext: boolean;
  identities: readonly Extract<ParameterBinding, { kind: 'identity' }>[];
  contextValues: readonly Extract<ParameterBinding, { kind: 'context-value' }>[];
  diagnosticName: string;
}
const location = (route: Route): HandlerLocation => ({
  controller: route.binding.type.name || '(anonymous)',
  method: route.metadata.method,
});
export class Dispatcher {
  private readonly commands = new Map<string, Route>();
  private readonly buttons = new Map<string, Route>();
  private readonly attachments: Route[] = [];
  private readonly events = new Map<string, Route[]>();
  private readonly moduleGuardChecks: (() => CanActivate)[] = [];
  private readonly middlewareChecks: (() => ContextMiddleware)[] = [];
  private readonly clock: Clock;
  private readonly cooldowns: CooldownStore;
  private readonly acknowledge: 'auto' | 'manual' | ((appId: string) => 'auto' | 'manual');
  constructor(
    container: Container,
    private readonly prefix: string,
    private readonly invalidInput: 'report' | 'reply' = 'report',
    private readonly catalog = new CommandCatalog(prefix),
    controls: {
      clock?: Clock;
      cooldownMaxEntries?: number;
      acknowledge?: 'auto' | 'manual' | ((appId: string) => 'auto' | 'manual');
    } = {},
  ) {
    this.clock = controls.clock ?? systemClock;
    this.cooldowns = new CooldownStore(controls.cooldownMaxEntries ?? 10000, this.clock);
    this.acknowledge = controls.acknowledge ?? 'auto';
    // Validate all module declarations, even when a module currently has no command routes.
    for (const { module, guards } of container.moduleGuards())
      for (const declaration of guards)
        if (!isBuiltinGuard(declaration))
          this.moduleGuardChecks.push(container.reference(declaration, module));
    let nextId = 0;
    for (const { module, middlewares } of container.moduleMiddlewares())
      for (const declaration of middlewares)
        this.middlewareChecks.push(container.reference(declaration, module));
    for (const binding of container.controllers())
      for (const metadata of readHandlers(
        binding.type,
        binding.moduleGuards,
        binding.moduleMiddlewares,
      )) {
        const route: Route = {
          binding,
          metadata,
          id: nextId++,
          diagnosticName:
            `${nextId - 1}:${binding.type.name || '(anonymous)'}.${metadata.method}`.slice(0, 256),
          needsContext: metadata.parameters.some((parameter) => parameter.kind === 'context'),
          identities: metadata.parameters.filter((parameter) => parameter.kind === 'identity'),
          contextValues: metadata.parameters.filter(
            (parameter) => parameter.kind === 'context-value',
          ),
          middlewares: metadata.middlewares.map((declaration) => {
            const reference = container.reference(declaration, binding.module);
            this.middlewareChecks.push(reference);
            return reference;
          }),
          guards: metadata.guards.map((declaration) => {
            if (!isBuiltinGuard(declaration))
              return container.reference(declaration, binding.module);
            const guard = createBuiltinGuard(declaration);
            return () => guard;
          }),
        };
        if (metadata.kind === 'attachment') {
          route.metadata = {
            ...metadata,
            name: `attachment:${binding.type.name || '(anonymous)'}.${metadata.method}`,
          };
          route.arguments = new CommandArguments(metadata.parameters);
          route.attachment = new AttachmentRoute(metadata.attachment ?? {});
          this.attachments.push(route);
          continue;
        }
        if (metadata.kind === 'command') {
          route.arguments = new CommandArguments(metadata.parameters);
          this.catalog.add(metadata, route.arguments);
        }
        if (
          typeof metadata.name !== 'string' ||
          !metadata.name ||
          (metadata.kind === 'command' && /\s/u.test(metadata.name))
        )
          throw new FrameworkError('ROUTE_CONFLICT', 'Invalid route name');
        if (metadata.kind === 'event') {
          this.events.set(metadata.name, [...(this.events.get(metadata.name) ?? []), route]);
        } else {
          const routes = metadata.kind === 'command' ? this.commands : this.buttons;
          const names =
            metadata.kind === 'command'
              ? [metadata.name, ...(metadata.options.aliases ?? [])]
              : [metadata.name];
          for (const name of names) {
            if (typeof name !== 'string' || !name || /\s/u.test(name) || routes.has(name))
              throw new FrameworkError('ROUTE_CONFLICT', `Duplicate or invalid route ${name}`);
            routes.set(name, route);
          }
        }
      }
  }

  validateControls(): void {
    for (const reference of this.middlewareChecks) assertMiddleware(reference());
    for (const reference of this.moduleGuardChecks) assertGuard(reference());
    for (const route of new Set([
      ...this.commands.values(),
      ...this.buttons.values(),
      ...this.attachments,
    ]))
      for (const reference of route.guards) assertGuard(reference());
  }
  close(): void {
    this.cooldowns.close();
  }

  private async hint(task: EventTask, route: Route, message?: string | false): Promise<void> {
    if (
      task.event.kind === 'button' &&
      (typeof this.acknowledge === 'function' ? this.acknowledge(task.appId) : this.acknowledge) ===
        'manual' &&
      !task.controller.signal.aborted
    )
      task.ack(0, location(route)).catch(() => {});
    if (!message || task.controller.signal.aborted || task.manualReplies) return;
    await task.send(message, task.event.kind === 'message', location(route));
  }

  private async controlled(
    task: EventTask,
    route: Route,
    matched?: readonly Attachment[],
  ): Promise<void> {
    const handler = location(route);
    let phase: ErrorPhase = 'middleware';
    let parsing = false;
    let invoked = false;
    let outcome: DiagnosticsOutcome = 'success';
    let observation: Observation | undefined;
    const previousContext = task.diagnosticContext;
    const routeContext = task.observer
      ? { ...previousContext, handler: route.diagnosticName }
      : undefined;
    const total = task.observer?.start('handler.total', routeContext, task.controller.signal);
    if (routeContext) {
      task.diagnosticContext = total?.context ?? routeContext;
      task.observer?.bind(task.controller.signal, task.diagnosticContext);
    }
    try {
      const cooldown = route.metadata.cooldown;
      const info =
        route.middlewares.length || route.guards.length || cooldown
          ? guardContext(
              task,
              route.binding.type,
              route.metadata.method,
              route.metadata.name,
              matched,
            )
          : undefined;
      if (info)
        for (let index = 0; index < route.middlewares.length; index++) {
          observation = task.observer?.start(
            'handler.middleware',
            { ...task.diagnosticContext, component: index },
            task.controller.signal,
          );
          await task.contextData(handler).prepare(route.middlewares[index]!(), info);
          observation?.end();
        }
      phase = 'guard';
      if (info)
        for (let index = 0; index < route.guards.length; index++) {
          observation = task.observer?.start(
            'handler.guard',
            { ...task.diagnosticContext, component: index },
            task.controller.signal,
          );
          const result = await runGuard(route.guards[index]!(), info, this.clock);
          if (result !== true) {
            observation?.end('rejected');
            outcome = 'rejected';
            await this.hint(task, route, result === false ? undefined : result.message);
            return;
          }
          observation?.end();
        }
      task.controller.signal.throwIfAborted();
      phase =
        task.event.kind === 'button' ? 'button' : matched === undefined ? 'command' : 'attachment';
      const context = route.needsContext
        ? task.event.kind === 'button'
          ? task.buttonContext(handler)
          : task.messageContext(handler)
        : undefined;
      let parameters: unknown[];
      observation = task.observer?.start('handler.bind', task.diagnosticContext);
      if (task.event.kind === 'message') {
        parsing = true;
        if (matched !== undefined) {
          parameters = route.arguments!.bind([], context, matched, true);
        } else {
          const parsed = tokenizeCommand(task.event.content, this.prefix);
          if (!parsed || !route.arguments) {
            outcome = 'ignored';
            observation?.end('ignored');
            return;
          }
          parameters = route.arguments.bind(parsed.tokens, context, task.event.attachments);
        }
        parsing = false;
      } else parameters = route.metadata.parameters.map(() => context);
      if (route.identities.length && task.event.kind !== 'event')
        bindIdentity(route.identities, parameters, task.event.identity);
      observation?.end();
      phase = 'context';
      observation = route.contextValues.length
        ? task.observer?.start('handler.context', task.diagnosticContext, task.controller.signal)
        : undefined;
      for (const parameter of route.contextValues)
        parameters[parameter.index] = await task.contextData(handler).reader.get(parameter.key);
      observation?.end();
      task.controller.signal.throwIfAborted();
      phase = 'cooldown';
      if (cooldown && info) {
        observation = task.observer?.start('handler.cooldown', task.diagnosticContext);
        const remaining = this.cooldowns.reserve(route.id, info, cooldown);
        observation?.end(remaining > 0 ? 'rejected' : 'success');
        if (remaining > 0) {
          outcome = 'rejected';
          await this.hint(
            task,
            route,
            cooldown.message ?? `操作太频繁，请在 ${Math.ceil(remaining / 1000)} 秒后再试。`,
          );
          return;
        }
      }
      phase =
        task.event.kind === 'button' ? 'button' : matched === undefined ? 'command' : 'attachment';
      invoked = true;
      observation = task.observer?.start(
        'handler.invoke',
        task.diagnosticContext,
        task.controller.signal,
      );
      const result = await this.invoke(route, context, parameters);
      observation?.end();
      if (task.event.kind === 'button') {
        if (result !== undefined)
          throw new FrameworkError('HANDLER_CONTRACT', 'Button handlers must return void');
      } else if (result !== undefined) {
        if (task.manualReplies)
          throw new FrameworkError(
            'HANDLER_CONTRACT',
            'Do not return another message after calling ctx.reply()',
          );
        await task.send(result as MessageInput, true, handler);
      }
    } catch (error) {
      observation?.fail(error, task.controller.signal);
      if (total) outcome = diagnosticOutcome(error, task.controller.signal);
      task.report(error, phase, handler);
      if (
        parsing &&
        error instanceof CommandInputError &&
        (matched === undefined ? this.invalidInput : route.metadata.attachment?.invalidInput) ===
          'reply'
      ) {
        try {
          await this.hint(
            task,
            route,
            matched === undefined
              ? `${error.message}\n${this.catalog.usage(route.metadata.name)}`
              : error.message,
          );
        } catch (sendError) {
          task.report(sendError, matched === undefined ? 'command' : 'attachment', handler);
        }
      }
    } finally {
      observation?.end();
      task.sealContextData();
      // In manual mode no handler will run to acknowledge a blocked button. ACK only receipt, not business success.
      if (
        !invoked &&
        task.event.kind === 'button' &&
        (typeof this.acknowledge === 'function'
          ? this.acknowledge(task.appId)
          : this.acknowledge) === 'manual' &&
        !task.controller.signal.aborted
      )
        task.ack(0, handler).catch(() => {});
      total?.end(outcome);
      task.diagnosticContext = previousContext;
      task.observer?.bind(task.controller.signal, previousContext);
    }
  }

  resetBot(appId: string): void {
    this.cooldowns.resetBot(appId);
  }

  handles(event: NormalizedEvent): boolean {
    if (this.events.has(event.raw.t)) return true;
    if (event.kind === 'button') return this.buttons.has(event.buttonId);
    if (event.kind !== 'message') return false;
    const content = event.content.trimStart();
    const name = content.startsWith(this.prefix)
      ? /^\S+/.exec(content.slice(this.prefix.length))?.[0]
      : undefined;
    return (
      (name !== undefined && this.commands.has(name)) ||
      this.attachments.some((route) => route.attachment!.matches(event.attachments))
    );
  }

  private async invoke(route: Route, context: unknown, parameters?: unknown[]): Promise<unknown> {
    const instance = route.binding.instance();
    const method: unknown = Reflect.get(instance, route.metadata.method);
    if (!callable(method)) throw new FrameworkError('HANDLER_CONTRACT', 'Handler is not callable');
    const params = parameters ?? route.metadata.parameters.map(() => context);
    return await method.apply(instance, params);
  }

  async dispatch(task: EventTask): Promise<void> {
    for (const route of this.events.get(task.event.raw.t) ?? []) {
      const previous = task.diagnosticContext;
      const context = task.observer ? { ...previous, handler: route.diagnosticName } : undefined;
      const observation = task.observer?.start('handler.observer', context, task.controller.signal);
      if (context) {
        task.diagnosticContext = observation?.context ?? context;
        task.observer?.bind(task.controller.signal, task.diagnosticContext);
      }
      try {
        if ((await this.invoke(route, task.context())) !== undefined)
          throw new FrameworkError('HANDLER_CONTRACT', 'Event observers must return void');
      } catch (error) {
        observation?.fail(error, task.controller.signal);
        task.report(error, 'observer', location(route));
      } finally {
        observation?.end();
        task.diagnosticContext = previous;
        task.observer?.bind(task.controller.signal, previous);
      }
    }
    if (task.controller.signal.aborted) return;
    if (task.event.kind === 'button') {
      const route = this.buttons.get(task.event.buttonId);
      if (route) await this.controlled(task, route);
      return;
    }
    if (task.event.kind !== 'message') return;
    const content = task.event.content.trimStart();
    const name = content.startsWith(this.prefix)
      ? /^\S+/.exec(content.slice(this.prefix.length))?.[0]
      : undefined;
    const route = name === undefined ? undefined : this.commands.get(name);
    if (route) {
      await this.controlled(task, route);
      return;
    }
    const attachments = task.event.attachments;
    const matches = this.attachments
      .map((route) => ({ route, matched: route.attachment!.select(attachments) }))
      .filter(({ matched }) => matched.length > 0);
    for (const { route, matched } of matches) {
      if (task.controller.signal.aborted) break;
      const invocation = task.invocation();
      try {
        await this.controlled(invocation, route, matched);
      } finally {
        await invocation.endInvocation();
      }
    }
  }
}
