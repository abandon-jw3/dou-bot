import type { InjectionToken, ModuleMetadata, Provider, Type } from '../contracts.js';
import { FrameworkError } from './errors.js';
import { constructorTokens, isController, readModule, readModuleGuards } from './metadata.js';
import type { GuardDeclaration } from './access.js';
import { bounded, callable, isObject, isType, own, throwIfAborted, tokenName } from './utils.js';
import { systemClock } from './clock.js';
import type { Clock } from './clock.js';

type Recipe =
  | { kind: 'class'; type: Type }
  | { kind: 'value'; value: unknown }
  | {
      kind: 'factory';
      create: (...dependencies: unknown[]) => unknown;
      tokens: readonly InjectionToken[];
    };
interface ModuleNode {
  type: Type;
  metadata: ModuleMetadata;
  imports: ModuleNode[];
  bindings: Map<InjectionToken, Binding>;
  guards: readonly GuardDeclaration[];
}
interface Binding {
  token: InjectionToken;
  owner: ModuleNode;
  recipe: Recipe;
  dependencies: Binding[];
  ready: boolean;
  value: unknown;
  controller: boolean;
}
export interface ControllerBinding {
  type: Type;
  module: Type;
  moduleGuards: readonly GuardDeclaration[];
  instance(): object;
}

function recipeOf(provider: Provider): { token: InjectionToken; recipe: Recipe } {
  if (isType(provider)) return { token: provider, recipe: { kind: 'class', type: provider } };
  if (!isObject(provider) || !('provide' in provider))
    throw new FrameworkError('DEPENDENCY', 'Invalid provider');
  const count = ['useValue', 'useClass', 'useFactory'].filter((key) => own(provider, key)).length;
  if (count !== 1)
    throw new FrameworkError('DEPENDENCY', 'A provider needs exactly one implementation');
  if ('useValue' in provider)
    return { token: provider.provide, recipe: { kind: 'value', value: provider.useValue } };
  if ('useClass' in provider && isType(provider.useClass))
    return { token: provider.provide, recipe: { kind: 'class', type: provider.useClass } };
  if ('useFactory' in provider && callable(provider.useFactory))
    return {
      token: provider.provide,
      recipe: {
        kind: 'factory',
        create: provider.useFactory,
        tokens: [...(provider.inject ?? [])],
      },
    };
  throw new FrameworkError('DEPENDENCY', 'Invalid provider implementation');
}

export class Container {
  private readonly modules = new Map<Type, ModuleNode>();
  private readonly builtins = new Map<InjectionToken, Binding>();
  private readonly order: Binding[] = [];
  private readonly managed: object[] = [];
  private readonly external = new Set<object>();
  private readonly registered = new Set<object>();
  private readonly destroyed = new Set<object>();
  private readonly labels = new WeakMap<object, string>();
  private initialization: Promise<void> | undefined;
  private readonly root: ModuleNode;

  constructor(
    root: Type,
    builtinValues: ReadonlyMap<InjectionToken, unknown> = new Map(),
    private readonly clock: Clock = systemClock,
  ) {
    const modulePath: Type[] = [];
    const visit = (type: Type): ModuleNode => {
      if (!isType(type)) throw new FrameworkError('DEPENDENCY', 'Module imports must be classes');
      if (modulePath.includes(type))
        throw new FrameworkError(
          'DEPENDENCY',
          `Circular modules: ${[...modulePath, type].map((t) => t.name).join(' -> ')}`,
        );
      const existing = this.modules.get(type);
      if (existing) return existing;
      const metadata = readModule(type);
      const node: ModuleNode = {
        type,
        metadata,
        imports: [],
        bindings: new Map(),
        guards: readModuleGuards(type),
      };
      this.modules.set(type, node);
      modulePath.push(type);
      node.imports = [...new Set(metadata.imports ?? [])].map(visit);
      modulePath.pop();
      for (const provider of metadata.providers ?? []) {
        const { token, recipe } = recipeOf(provider);
        if (!(typeof token === 'string' || typeof token === 'symbol' || isType(token)))
          throw new FrameworkError('DEPENDENCY', `Invalid token in ${type.name}`);
        if (builtinValues.has(token) || node.bindings.has(token))
          throw new FrameworkError(
            'DEPENDENCY',
            `Duplicate or reserved provider ${tokenName(token)} in ${type.name}`,
          );
        node.bindings.set(token, {
          token,
          owner: node,
          recipe,
          dependencies: [],
          ready: false,
          value: undefined,
          controller: false,
        });
        if (recipe.kind === 'value' && isObject(recipe.value)) this.external.add(recipe.value);
      }
      for (const controller of metadata.controllers ?? []) {
        if (!isType(controller) || !isController(controller))
          throw new FrameworkError('DEPENDENCY', `Invalid controller in ${type.name}`);
        if (node.bindings.has(controller) || builtinValues.has(controller))
          throw new FrameworkError('DEPENDENCY', `Duplicate controller ${controller.name}`);
        node.bindings.set(controller, {
          token: controller,
          owner: node,
          recipe: { kind: 'class', type: controller },
          dependencies: [],
          ready: false,
          value: undefined,
          controller: true,
        });
      }
      return node;
    };
    this.root = visit(root);
    for (const [token, value] of builtinValues)
      this.builtins.set(token, {
        token,
        owner: this.root,
        recipe: { kind: 'value', value },
        dependencies: [],
        ready: true,
        value,
        controller: false,
      });
    for (const node of this.modules.values()) {
      for (const token of node.metadata.exports ?? []) {
        const binding = this.find(token, node);
        if (binding.controller)
          throw new FrameworkError(
            'DEPENDENCY',
            `Controllers cannot be exported: ${tokenName(token)}`,
          );
      }
      for (const binding of node.bindings.values()) {
        const tokens =
          binding.recipe.kind === 'class'
            ? constructorTokens(binding.recipe.type, binding.controller)
            : binding.recipe.kind === 'factory'
              ? binding.recipe.tokens
              : [];
        binding.dependencies = tokens.map((token) => {
          const dependency = this.find(token, node);
          if (dependency.controller)
            throw new FrameworkError(
              'DEPENDENCY',
              `Inject a service instead of controller ${tokenName(token)}`,
            );
          return dependency;
        });
      }
    }
    const visited = new Set<Binding>();
    const path: Binding[] = [];
    const sort = (binding: Binding) => {
      if (path.includes(binding))
        throw new FrameworkError(
          'DEPENDENCY',
          `Circular providers: ${[...path, binding].map((b) => `${b.owner.type.name}:${tokenName(b.token)}`).join(' -> ')}`,
        );
      if (visited.has(binding)) return;
      path.push(binding);
      for (const dependency of binding.dependencies) sort(dependency);
      path.pop();
      visited.add(binding);
      this.order.push(binding);
    };
    for (const node of this.modules.values())
      for (const binding of node.bindings.values()) sort(binding);
  }

  private find(token: InjectionToken, node: ModuleNode): Binding {
    const ownBinding = node.bindings.get(token);
    if (ownBinding) return ownBinding;
    const candidates = new Set<Binding>();
    for (const imported of node.imports) {
      if (imported.metadata.exports?.includes(token)) candidates.add(this.find(token, imported));
    }
    if (candidates.size > 1)
      throw new FrameworkError('DEPENDENCY', `Ambiguous ${tokenName(token)} in ${node.type.name}`);
    const candidate = candidates.values().next().value;
    if (candidate) return candidate;
    const builtin = this.builtins.get(token);
    if (builtin) return builtin;
    throw new FrameworkError(
      'DEPENDENCY',
      `Provider ${tokenName(token)} is not visible in ${node.type.name}`,
    );
  }

  initialize(): Promise<void> {
    this.initialization ??= this.construct();
    return this.initialization;
  }

  private async construct(): Promise<void> {
    for (const binding of this.order) {
      if (binding.ready) continue;
      const args = binding.dependencies.map((dependency) => dependency.value);
      const recipe = binding.recipe;
      const value: unknown =
        recipe.kind === 'value'
          ? recipe.value
          : recipe.kind === 'class'
            ? new recipe.type(...args)
            : await recipe.create(...args);
      binding.value = value;
      binding.ready = true;
      if (
        recipe.kind !== 'value' &&
        isObject(value) &&
        !this.external.has(value) &&
        !this.registered.has(value)
      ) {
        this.registered.add(value);
        this.managed.push(value);
        this.labels.set(value, `${binding.owner.type.name}:${tokenName(binding.token)}`);
      }
    }
  }

  get<T>(token: InjectionToken<T>, module?: Type): T {
    const node = module ? this.modules.get(module) : this.root;
    if (!node) throw new FrameworkError('DEPENDENCY', 'Module does not belong to this application');
    const binding = this.find(token, node);
    if (!binding.ready)
      throw new FrameworkError('INVALID_STATE', `Provider ${tokenName(token)} is not initialized`);
    return binding.value as T;
  }

  /** Compile a module-scoped provider reference before constructing any instances. */
  reference<T>(token: InjectionToken<T>, module: Type): () => T {
    const node = this.modules.get(module);
    if (!node) throw new FrameworkError('DEPENDENCY', 'Unknown provider module');
    const binding = this.find(token, node);
    if (binding.controller)
      throw new FrameworkError('DEPENDENCY', 'Guards must be providers, not controllers');
    return () => {
      if (!binding.ready) throw new FrameworkError('INVALID_STATE', 'Provider is not initialized');
      return binding.value as T;
    };
  }

  moduleGuards(): { module: Type; guards: readonly GuardDeclaration[] }[] {
    return [...this.modules.values()].map((node) => ({ module: node.type, guards: node.guards }));
  }

  controllers(): ControllerBinding[] {
    const ordered: ModuleNode[] = [];
    const visited = new Set<ModuleNode>();
    const visit = (node: ModuleNode) => {
      if (visited.has(node)) return;
      visited.add(node);
      node.imports.forEach(visit);
      ordered.push(node);
    };
    visit(this.root);
    return ordered.flatMap((node) =>
      [...node.bindings.values()]
        .filter((binding) => binding.controller)
        .map((binding) => ({
          type: binding.token as Type,
          module: node.type,
          moduleGuards: node.guards,
          instance: () => {
            if (!binding.ready || !isObject(binding.value))
              throw new FrameworkError('INVALID_STATE', 'Controller is not initialized');
            return binding.value;
          },
        })),
    );
  }

  async callInitHooks(signal: AbortSignal): Promise<void> {
    for (const instance of this.managed) {
      throwIfAborted(signal);
      const hook: unknown = Reflect.get(instance, 'onModuleInit');
      if (callable(hook)) await hook.call(instance, signal);
      throwIfAborted(signal);
    }
  }

  async destroy(deadline: number): Promise<void> {
    const controller = new AbortController();
    const failures: unknown[] = [];
    let timedOut = false;
    for (const instance of [...this.managed].reverse()) {
      if (this.destroyed.has(instance)) continue;
      this.destroyed.add(instance);
      try {
        const hook: unknown = Reflect.get(instance, 'onModuleDestroy');
        if (!callable(hook)) continue;
        if (this.clock.monotonic() >= deadline) {
          timedOut = true;
          controller.abort(new FrameworkError('SHUTDOWN_TIMEOUT', 'Cleanup deadline exceeded'));
        }
        const result: unknown = hook.call(instance, controller.signal);
        await bounded(Promise.resolve(result), deadline, undefined, this.clock);
      } catch (error) {
        failures.push(
          new FrameworkError(
            'CLEANUP_FAILED',
            `Cleanup failed for ${this.labels.get(instance) ?? 'resource'}`,
            { cause: error },
          ),
        );
        if (error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT') {
          timedOut = true;
          controller.abort(error);
        }
      }
    }
    if (failures.length || timedOut)
      throw new FrameworkError(
        timedOut ? 'SHUTDOWN_TIMEOUT' : 'CLEANUP_FAILED',
        'One or more resources could not be released cleanly',
        { cause: new AggregateError(failures) },
      );
  }
}
