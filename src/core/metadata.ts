import 'reflect-metadata/lite';
import type {
  ArgumentOptions,
  AccessOptions,
  CommandOptions,
  CanActivate,
  CooldownOptions,
  GroupRole,
  InjectionToken,
  ModuleMetadata,
  OptionOptions,
  RestOptions,
  SlotOptions,
  Type,
  UsersOnlyOptions,
} from '../contracts.js';
import { FrameworkError } from './errors.js';
import { cooldownOptions } from './cooldown.js';
import { isRecord, isType, tokenName } from './utils.js';
import { rolesGuard, sceneGuard, usersGuard, validateAccessRules } from './access.js';
import type { GuardDeclaration } from './access.js';

const MODULE = Symbol('module');
const INJECTABLE = Symbol('injectable');
const CONTROLLER = Symbol('controller');
const INJECT = Symbol('inject');
const HANDLERS = Symbol('handlers');
const PARAMETERS = Symbol('parameters');
const GUARDS = Symbol('guards');
const COOLDOWN = Symbol('cooldown');

type ParameterDeclaration =
  | { kind: 'context' }
  | { kind: 'args' }
  | { kind: 'arg'; argument: number; options?: ArgumentOptions }
  | { kind: 'option'; key: string; options: OptionOptions }
  | { kind: 'slot'; key: string; options: SlotOptions }
  | { kind: 'rest'; options: RestOptions };
export type ParameterBinding = ParameterDeclaration & { index: number };
export interface HandlerMetadata {
  method: string;
  kind: 'command' | 'event' | 'button';
  name: string;
  options: CommandOptions;
  parameters: readonly ParameterBinding[];
  guards: readonly GuardDeclaration[];
  cooldown?: Readonly<CooldownOptions>;
}
type HandlerDeclaration = Omit<HandlerMetadata, 'parameters' | 'guards' | 'cooldown'>;

function metadata<T>(key: symbol | string, target: object, method?: string): T | undefined {
  const value: unknown =
    method === undefined
      ? Reflect.getOwnMetadata(key, target)
      : Reflect.getOwnMetadata(key, target, method);
  return value as T | undefined;
}

export function Module(data: ModuleMetadata): ClassDecorator {
  return (target) => {
    if (metadata(MODULE, target)) throw new FrameworkError('CONFIG', 'Duplicate @Module');
    Reflect.defineMetadata(
      MODULE,
      Object.freeze({
        imports: Object.freeze([...(data.imports ?? [])]),
        providers: Object.freeze([...(data.providers ?? [])]),
        controllers: Object.freeze([...(data.controllers ?? [])]),
        exports: Object.freeze([...(data.exports ?? [])]),
      }),
      target,
    );
  };
}
export function Injectable(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(INJECTABLE, true, target);
  };
}
export function Controller(): ClassDecorator {
  return (target) => {
    Reflect.defineMetadata(CONTROLLER, true, target);
  };
}
export function Inject(token: InjectionToken): ParameterDecorator {
  return (target, key, index) => {
    if (key !== undefined || typeof target !== 'function') {
      throw new FrameworkError('CONFIG', '@Inject only supports constructor parameters');
    }
    const bindings = new Map(metadata<Map<number, InjectionToken>>(INJECT, target));
    if (bindings.has(index)) throw new FrameworkError('CONFIG', 'Duplicate @Inject parameter');
    bindings.set(index, token);
    Reflect.defineMetadata(INJECT, bindings, target);
  };
}

function handler(
  kind: HandlerMetadata['kind'],
  name: string,
  options: CommandOptions = {},
): MethodDecorator {
  if (
    !isRecord(options) ||
    (options.aliases !== undefined && !Array.isArray(options.aliases)) ||
    (options.description !== undefined && typeof options.description !== 'string')
  )
    throw new FrameworkError('CONFIG', 'Invalid handler options');
  const declarationOptions: CommandOptions = Object.freeze({
    ...options,
    aliases: Object.freeze([...((options.aliases as readonly string[] | undefined) ?? [])]),
  });
  return (target, key, descriptor) => {
    if (
      typeof target === 'function' ||
      typeof key !== 'string' ||
      typeof descriptor.value !== 'function'
    ) {
      throw new FrameworkError('CONFIG', 'Handlers must be named instance methods');
    }
    const entries = [...(metadata<HandlerDeclaration[]>(HANDLERS, target) ?? [])];
    if (entries.some((item) => item.method === key))
      throw new FrameworkError('ROUTE_CONFLICT', `Multiple routes on ${key}`);
    entries.push({
      method: key,
      kind,
      name,
      options: declarationOptions,
    });
    Reflect.defineMetadata(HANDLERS, entries, target);
  };
}
export const Command = (name: string, options?: CommandOptions): MethodDecorator =>
  handler('command', name, options);
export const On = (eventName: string): MethodDecorator => handler('event', eventName);
export const OnButton = (buttonId: string): MethodDecorator => handler('button', buttonId);

export function UseGuards(
  ...guards: readonly InjectionToken<CanActivate>[]
): ClassDecorator & MethodDecorator {
  if (
    !guards.length ||
    guards.some(
      (token) =>
        !(
          typeof token === 'symbol' ||
          (typeof token === 'string' && token.length > 0) ||
          isType(token)
        ),
    )
  )
    throw new FrameworkError('CONFIG', '@UseGuards requires provider tokens');
  return guardDecorator([...guards]);
}

function guardDecorator(guards: readonly GuardDeclaration[]): ClassDecorator & MethodDecorator {
  return (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    const classLevel = key === undefined && typeof target === 'function';
    if (
      !classLevel &&
      (typeof target === 'function' ||
        typeof key !== 'string' ||
        typeof descriptor?.value !== 'function')
    )
      throw new FrameworkError(
        'CONFIG',
        'Guard decorators require a class or named instance method',
      );
    const previous = metadata<readonly GuardDeclaration[]>(GUARDS, target, key) ?? [];
    const value = Object.freeze([...guards, ...previous]);
    if (classLevel) Reflect.defineMetadata(GUARDS, value, target);
    else Reflect.defineMetadata(GUARDS, value, target, key!);
  };
}

export function GroupOnly(options: AccessOptions = {}): ClassDecorator & MethodDecorator {
  return guardDecorator([sceneGuard('group', options)]);
}
export function PrivateOnly(options: AccessOptions = {}): ClassDecorator & MethodDecorator {
  return guardDecorator([sceneGuard('private', options)]);
}
export function UsersOnly(
  userIds: readonly string[],
  options: UsersOnlyOptions = {},
): ClassDecorator & MethodDecorator {
  return guardDecorator([usersGuard(userIds, options)]);
}
export function GroupRoles(...roles: readonly GroupRole[]): ClassDecorator & MethodDecorator {
  return guardDecorator([rolesGuard(roles)]);
}
export function GroupManagersOnly(options: AccessOptions = {}): ClassDecorator & MethodDecorator {
  // Validate before adding the default, so malformed input is never silently ignored.
  const rule = rolesGuard(['owner', 'admin'], options);
  return guardDecorator([
    Object.freeze({ ...rule, message: options.message ?? '此操作仅限群主或管理员。' }),
  ]);
}

export function Cooldown(options: CooldownOptions): MethodDecorator {
  const value = cooldownOptions(options);
  return (target, key, descriptor) => {
    if (
      typeof target === 'function' ||
      typeof key !== 'string' ||
      typeof descriptor.value !== 'function'
    )
      throw new FrameworkError('CONFIG', '@Cooldown requires a named instance method');
    if (metadata(COOLDOWN, target, key)) throw new FrameworkError('CONFIG', 'Duplicate @Cooldown');
    Reflect.defineMetadata(COOLDOWN, value, target, key);
  };
}

function classGuards(type: Type): readonly GuardDeclaration[] {
  const result: GuardDeclaration[] = [];
  let current: unknown = type;
  while (isType(current)) {
    result.unshift(...(metadata<readonly GuardDeclaration[]>(GUARDS, current) ?? []));
    current = Object.getPrototypeOf(current);
  }
  return result;
}

function snapshot<T extends object>(options: T): T {
  if (!isRecord(options)) throw new FrameworkError('CONFIG', 'Parameter options must be an object');
  return Object.freeze({
    ...options,
    ...(Array.isArray(options.choices)
      ? { choices: Object.freeze([...(options.choices as unknown[])]) }
      : {}),
  });
}

function parameter(declaration: ParameterDeclaration): ParameterDecorator {
  return (target, key, index) => {
    if (typeof target === 'function' || typeof key !== 'string')
      throw new FrameworkError('CONFIG', 'Handler parameters require an instance method');
    if (
      declaration.kind === 'arg' &&
      (!Number.isSafeInteger(declaration.argument) || declaration.argument < 0)
    )
      throw new FrameworkError('CONFIG', '@Arg index must be a non-negative integer');
    const entries = [...(metadata<ParameterBinding[]>(PARAMETERS, target, key) ?? [])];
    if (entries.some((item) => item.index === index))
      throw new FrameworkError('CONFIG', `Duplicate parameter binding on ${key}`);
    entries.push(Object.freeze({ index, ...declaration }));
    Reflect.defineMetadata(PARAMETERS, entries, target, key);
  };
}
export const Ctx = (): ParameterDecorator => parameter({ kind: 'context' });
export const Args = (): ParameterDecorator => parameter({ kind: 'args' });
export const Arg = (index: number, options?: ArgumentOptions): ParameterDecorator =>
  parameter({
    kind: 'arg',
    argument: index,
    ...(options === undefined ? {} : { options: snapshot(options) }),
  });
export const Option = (name: string, options: OptionOptions = {}): ParameterDecorator =>
  parameter({ kind: 'option', key: name, options: snapshot(options) });
export const Slot = (name: string, options: SlotOptions): ParameterDecorator =>
  parameter({ kind: 'slot', key: name, options: snapshot(options) });
export const Rest = (options: RestOptions = {}): ParameterDecorator =>
  parameter({ kind: 'rest', options: snapshot(options) });

export function readModule(type: Type): ModuleMetadata {
  const result = metadata<ModuleMetadata>(MODULE, type);
  if (!result) throw new FrameworkError('DEPENDENCY', `${type.name} is missing @Module`);
  return result;
}
export const isController = (type: Type): boolean => metadata(CONTROLLER, type) === true;

export function constructorTokens(type: Type, controller = false): InjectionToken[] {
  if (!(controller ? isController(type) : metadata(INJECTABLE, type) === true)) {
    throw new FrameworkError(
      'DEPENDENCY',
      `${type.name} requires ${controller ? '@Controller' : '@Injectable'}`,
    );
  }
  const types = metadata<unknown[]>('design:paramtypes', type);
  const parent: unknown = Object.getPrototypeOf(type);
  if (
    types === undefined &&
    isType(parent) &&
    (Reflect.getMetadata('design:paramtypes', parent) as unknown[] | undefined)?.length
  ) {
    throw new FrameworkError(
      'DEPENDENCY',
      `${type.name} must explicitly declare its inherited constructor dependencies`,
    );
  }
  const overrides =
    metadata<Map<number, InjectionToken>>(INJECT, type) ?? new Map<number, InjectionToken>();
  const length = Math.max(
    type.length,
    types?.length ?? 0,
    ...[...overrides.keys()].map((i) => i + 1),
  );
  const forbidden = new Set<unknown>([Object, Function, String, Number, Boolean, Array, Promise]);
  return Array.from({ length }, (_, index) => {
    const token: unknown = overrides.has(index) ? overrides.get(index) : types?.[index];
    if (
      (!overrides.has(index) && forbidden.has(token)) ||
      !(typeof token === 'string' || typeof token === 'symbol' || isType(token))
    ) {
      throw new FrameworkError(
        'DEPENDENCY',
        `Cannot infer ${type.name} constructor parameter ${index}; use a value import or @Inject(token)`,
      );
    }
    return token;
  });
}

export function readHandlers(type: Type): HandlerMetadata[] {
  const result: HandlerMetadata[] = [];
  const seen = new Set<string>();
  const controllerGuards = classGuards(type);
  validateAccessRules(controllerGuards);
  let prototype: object | null = type.prototype as object;
  while (prototype && prototype !== Object.prototype) {
    const declarations = metadata<HandlerDeclaration[]>(HANDLERS, prototype) ?? [];
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (seen.has(key)) continue;
      if (
        (metadata(GUARDS, prototype, key) || metadata(COOLDOWN, prototype, key)) &&
        !declarations.some((entry) => entry.method === key && entry.kind !== 'event')
      )
        throw new FrameworkError(
          'CONFIG',
          'Method guards and cooldowns require @Command or @OnButton',
        );
    }
    for (const entry of declarations) {
      if (seen.has(entry.method)) continue;
      const parameters = metadata<ParameterBinding[]>(PARAMETERS, prototype, entry.method) ?? [];
      const parameterTypes =
        metadata<unknown[]>('design:paramtypes', prototype, entry.method) ?? [];
      const method: unknown = Object.getOwnPropertyDescriptor(prototype, entry.method)?.value;
      const count = Math.max(
        typeof method === 'function' ? method.length : 0,
        parameterTypes.length,
      );
      if (
        parameters.length !== count ||
        parameters.some(
          (p) => p.index >= count || (entry.kind !== 'command' && p.kind !== 'context'),
        )
      ) {
        throw new FrameworkError(
          'CONFIG',
          `Invalid parameter decorators on ${tokenName(type)}.${entry.method}`,
        );
      }
      const cooldown = metadata<Readonly<CooldownOptions>>(COOLDOWN, prototype, entry.method);
      const guards =
        entry.kind === 'event'
          ? []
          : [
              ...controllerGuards,
              ...(metadata<readonly GuardDeclaration[]>(GUARDS, prototype, entry.method) ?? []),
            ];
      if (entry.kind !== 'event') validateAccessRules(guards, entry.kind);
      result.push({
        ...entry,
        parameters: [...parameters].sort((a, b) => a.index - b.index),
        guards,
        ...(cooldown === undefined ? {} : { cooldown }),
      });
    }
    for (const key of Object.getOwnPropertyNames(prototype)) seen.add(key);
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return result.sort((a, b) => (a.method < b.method ? -1 : a.method > b.method ? 1 : 0));
}
