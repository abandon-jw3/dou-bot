import type { ParameterBinding } from './metadata.js';
import type { ArgumentToken } from './parser.js';
import type { Attachment } from '../contracts.js';
import { attachmentLabels, selectAttachments } from './attachments.js';
import type { AttachmentSelection } from './attachments.js';
import { FrameworkError } from './errors.js';
import { CommandInputError } from './input-error.js';
import { isRecord } from './utils.js';

type Scalar = string | number | boolean;
interface Description {
  name: string;
  description?: string;
}
interface ValueRule extends Description {
  type: 'string' | 'number' | 'integer' | 'boolean';
  required: boolean;
  default?: Scalar;
  choices?: readonly Scalar[];
  min?: number;
  max?: number;
}
type ValueParameter = ValueRule &
  (
    | { kind: 'arg'; argument: number; index: number }
    | { kind: 'option'; key: string; alias?: string; index: number }
  );
interface SlotParameter extends Description {
  kind: 'slot';
  index: number;
  key: string;
  required: boolean;
  default?: string;
  choices?: readonly string[];
  match?: (text: string) => boolean;
}
interface AttachmentParameter extends Description {
  kind: 'attachments';
  index: number;
  selection: AttachmentSelection;
  minCount: number;
  maxCount?: number;
}
type CompiledParameter =
  | ValueParameter
  | SlotParameter
  | AttachmentParameter
  | (Description & { kind: 'rest'; index: number })
  | { kind: 'context'; index: number }
  | Extract<ParameterBinding, { kind: 'identity' }>
  | { kind: 'args'; index: number };

function config(message: string): never {
  throw new FrameworkError('CONFIG', message);
}
function keys(
  options: unknown,
  allowed: readonly string[],
): asserts options is Record<string, unknown> {
  if (!isRecord(options)) config('Parameter options must be an object');
  for (const key of Object.keys(options))
    if (!allowed.includes(key)) config(`Unknown parameter option: ${key}`);
}
function describe(options: Record<string, unknown>, fallback: string): Description {
  const name = options.name === undefined ? fallback : options.name;
  if (typeof name !== 'string' || !name.trim() || /[\r\n\t]/u.test(name))
    config('Parameter name must be a nonempty single-line string');
  if (options.description !== undefined && typeof options.description !== 'string')
    config('Parameter description must be a string');
  if (options.required !== undefined && typeof options.required !== 'boolean')
    config('Parameter required must be boolean');
  if (options.required === true && options.default !== undefined)
    config('A required parameter cannot have a default');
  return {
    name,
    ...(options.description === undefined ? {} : { description: options.description }),
  };
}
function typed(value: unknown, type: ValueRule['type']): value is Scalar {
  switch (type) {
    case 'integer':
      return typeof value === 'number' && Number.isSafeInteger(value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'string':
      return typeof value === 'string';
  }
}
const typeLabels: Record<ValueRule['type'], string> = {
  string: '文本',
  integer: '安全整数',
  number: '有限数字',
  boolean: 'true 或 false',
};
function constraint(value: Scalar, rule: ValueRule): string | undefined {
  if (!typed(value, rule.type)) return `${rule.name} 必须是${typeLabels[rule.type]}`;
  if (typeof value === 'number') {
    if (rule.min !== undefined && value < rule.min) return `${rule.name} 不能小于 ${rule.min}`;
    if (rule.max !== undefined && value > rule.max) return `${rule.name} 不能大于 ${rule.max}`;
  }
  if (rule.choices && !rule.choices.includes(value))
    return `${rule.name} 必须是以下值之一：${rule.choices.join('、')}`;
  return undefined;
}
function valueRule(options: Record<string, unknown>, fallback: string): ValueRule {
  const description = describe(options, fallback);
  const type = options.type === undefined ? 'string' : options.type;
  if (type !== 'string' && type !== 'integer' && type !== 'number' && type !== 'boolean')
    config('Invalid parameter type');
  const numeric = type === 'integer' || type === 'number';
  for (const key of ['min', 'max'] as const)
    if (options[key] !== undefined && (!numeric || !typed(options[key], type)))
      config(`${key} requires a finite ${type} constraint`);
  if (
    typeof options.min === 'number' &&
    typeof options.max === 'number' &&
    options.min > options.max
  )
    config('Parameter min cannot exceed max');
  if (
    options.choices !== undefined &&
    (type === 'boolean' ||
      !Array.isArray(options.choices) ||
      options.choices.length === 0 ||
      options.choices.some((value: unknown) => !typed(value, type)) ||
      new Set(options.choices as unknown[]).size !== options.choices.length)
  )
    config('Parameter choices must be nonempty, unique values of the declared type');
  const rule: ValueRule = {
    ...description,
    type,
    required: options.required === true,
    ...(options.min === undefined ? {} : { min: options.min as number }),
    ...(options.max === undefined ? {} : { max: options.max as number }),
    ...(options.default === undefined ? {} : { default: options.default as Scalar }),
    ...(options.choices === undefined ? {} : { choices: options.choices as Scalar[] }),
  };
  if (rule.default !== undefined) {
    const error = constraint(rule.default, rule);
    if (error) config(`Invalid default: ${error}`);
  }
  for (const choice of rule.choices ?? []) {
    const error = constraint(choice, rule);
    if (error) config(`Invalid choice: ${error}`);
  }
  return rule;
}

function matches(slot: SlotParameter, value: string): boolean {
  if (slot.choices && !slot.choices.includes(value)) return false;
  if (!slot.match) return true;
  let result: unknown;
  try {
    result = slot.match(value);
  } catch (cause) {
    throw new FrameworkError('HANDLER_CONTRACT', `Slot matcher failed: ${slot.key}`, { cause });
  }
  if (typeof result !== 'boolean') {
    // Absorb a mistakenly returned rejected Promise, while rejecting async matchers as a contract error.
    void Promise.resolve(result).catch(() => {});
    throw new FrameworkError(
      'HANDLER_CONTRACT',
      `Slot matcher must return a synchronous boolean: ${slot.key}`,
    );
  }
  return result;
}

const commonKeys = ['name', 'description', 'required', 'default'];
const valueKeys = [...commonKeys, 'type', 'choices', 'min', 'max'];
function compile(binding: ParameterBinding): CompiledParameter {
  if (binding.kind === 'context' || binding.kind === 'args' || binding.kind === 'identity')
    return binding;
  const options = binding.options ?? {};
  if (binding.kind === 'attachments') {
    keys(options, ['name', 'description', 'minCount', 'maxCount']);
    for (const key of ['minCount', 'maxCount'] as const) {
      const value = options[key];
      if (
        value !== undefined &&
        (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
      )
        config(`Attachment ${key} must be a non-negative safe integer`);
    }
    const minCount = options.minCount === undefined ? 0 : (options.minCount as number);
    const maxCount = options.maxCount as number | undefined;
    if (maxCount !== undefined && maxCount < minCount)
      config('Attachment maxCount cannot be less than minCount');
    return {
      kind: 'attachments',
      index: binding.index,
      selection: binding.selection,
      ...describe(options, attachmentLabels[binding.selection]),
      minCount,
      ...(maxCount === undefined ? {} : { maxCount }),
    };
  }
  if (binding.kind === 'rest') {
    keys(options, ['name', 'description']);
    return { kind: 'rest', index: binding.index, ...describe(options, '剩余参数') };
  }
  if (binding.kind === 'slot') {
    if (typeof binding.key !== 'string' || !binding.key || /\s/u.test(binding.key))
      config('Invalid Slot name');
    keys(options, [...commonKeys, 'choices', 'match']);
    const description = describe(options, binding.key);
    if (options.match === undefined && options.choices === undefined)
      config('Slot requires choices or match');
    if (options.match !== undefined && typeof options.match !== 'function')
      config('Slot match must be a function');
    if (
      options.choices !== undefined &&
      (!Array.isArray(options.choices) ||
        !options.choices.length ||
        options.choices.some((value: unknown) => typeof value !== 'string') ||
        new Set(options.choices as unknown[]).size !== options.choices.length)
    )
      config('Slot choices must be nonempty, unique strings');
    if (options.default !== undefined && typeof options.default !== 'string')
      config('Slot default must be a string');
    const slot: SlotParameter = {
      kind: 'slot',
      index: binding.index,
      key: binding.key,
      ...description,
      required: options.required === true,
      ...(options.default === undefined ? {} : { default: options.default }),
      ...(options.choices === undefined ? {} : { choices: options.choices as string[] }),
      ...(options.match === undefined ? {} : { match: options.match as (text: string) => boolean }),
    };
    if (slot.default !== undefined && !matches(slot, slot.default))
      config(`Invalid default for Slot ${slot.key}`);
    return slot;
  }
  keys(options, [...valueKeys, ...(binding.kind === 'option' ? ['alias'] : [])]);
  if (binding.kind === 'arg')
    return { ...binding, ...valueRule(options, `参数${binding.argument + 1}`) };
  if (typeof binding.key !== 'string' || !/^[a-zA-Z][\w-]*$/u.test(binding.key))
    config('Option name must start with an ASCII letter and contain letters, digits, _ or -');
  if (
    options.alias !== undefined &&
    (typeof options.alias !== 'string' || !/^[a-zA-Z]$/u.test(options.alias))
  )
    config('Option alias must be one ASCII letter');
  return {
    kind: 'option',
    index: binding.index,
    key: binding.key,
    ...valueRule(options, `--${binding.key}`),
    ...(options.alias === undefined ? {} : { alias: options.alias }),
  };
}

function convert(raw: string | undefined, rule: ValueRule): Scalar | undefined {
  if (raw === undefined) {
    if (rule.required) throw new CommandInputError(`缺少必填参数：${rule.name}`);
    return rule.default;
  }
  let value: Scalar = raw;
  if (rule.type === 'integer') value = /^[+-]?\d+$/u.test(raw) ? Number(raw) : NaN;
  else if (rule.type === 'number')
    value = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(raw) ? Number(raw) : NaN;
  else if (rule.type === 'boolean') {
    if (raw !== 'true' && raw !== 'false')
      throw new CommandInputError(`${rule.name} 必须是 true 或 false`);
    value = raw === 'true';
  }
  const error = constraint(value, rule);
  if (error) throw new CommandInputError(error);
  return value;
}

function optionLike(token: ArgumentToken): boolean {
  return !token.literal && (token.value.startsWith('--') || /^-[a-zA-Z]/u.test(token.value));
}
function usage(parameter: CompiledParameter): string | undefined {
  switch (parameter.kind) {
    case 'arg':
      return parameter.required ? `<${parameter.name}>` : `[${parameter.name}]`;
    case 'slot':
      return parameter.required ? `<${parameter.name}·无序>` : `[${parameter.name}·无序]`;
    case 'option': {
      const value = parameter.type === 'boolean' ? '' : ` <${parameter.name}>`;
      return parameter.required ? `--${parameter.key}${value}` : `[--${parameter.key}${value}]`;
    }
    case 'rest':
      return `[${parameter.name}...]`;
    case 'attachments': {
      const label = parameter.name.endsWith('附件') ? parameter.name : `${parameter.name}附件`;
      return parameter.minCount > 0 ? `<${label}>` : `[${label}]`;
    }
    default:
      return undefined;
  }
}

/** Compiled once at bootstrap; all mutable consumption state belongs to one invocation. */
export class CommandArguments {
  private readonly parameters: CompiledParameter[];
  private readonly options = new Map<string, ValueParameter & { kind: 'option' }>();
  private readonly enhanced: boolean;
  constructor(bindings: readonly ParameterBinding[]) {
    this.enhanced = bindings.some(
      (p) =>
        p.kind === 'slot' ||
        p.kind === 'option' ||
        p.kind === 'rest' ||
        (p.kind === 'arg' && p.options !== undefined),
    );
    this.parameters = bindings.map(compile);
    const positions = new Set<number>();
    const slots = new Set<string>();
    let rest = false;
    for (const parameter of this.parameters) {
      if (parameter.kind === 'arg' && this.enhanced) {
        if (positions.has(parameter.argument))
          config('Duplicate @Arg position in a structured command');
        positions.add(parameter.argument);
      } else if (parameter.kind === 'slot') {
        if (slots.has(parameter.key)) config(`Duplicate Slot: ${parameter.key}`);
        slots.add(parameter.key);
      } else if (parameter.kind === 'rest') {
        if (rest) config('Only one @Rest is allowed per command');
        rest = true;
      } else if (parameter.kind === 'option') {
        for (const name of [
          `--${parameter.key}`,
          ...(parameter.alias ? [`-${parameter.alias}`] : []),
        ]) {
          if (this.options.has(name)) config(`Duplicate option or alias: ${name}`);
          this.options.set(name, parameter);
        }
      }
    }
  }

  bind(
    tokens: readonly ArgumentToken[],
    context: unknown,
    attachments: readonly Attachment[] = [],
  ): unknown[] {
    const args = tokens.map((token) => token.value);
    if (!this.enhanced) {
      const values = this.parameters.map((parameter) =>
        parameter.kind === 'context'
          ? context
          : parameter.kind === 'args'
            ? [...args]
            : parameter.kind === 'arg'
              ? args[parameter.argument]
              : undefined,
      );
      return this.bindAttachments(values, attachments);
    }

    const positional: string[] = [];
    const values = new Map<number, unknown>();
    let terminated = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (!terminated && !token.literal && token.value === '--') {
        terminated = true;
        continue;
      }
      if (terminated || !optionLike(token)) {
        positional.push(token.value);
        continue;
      }
      const equal = token.value.indexOf('=');
      const key = equal < 0 ? token.value : token.value.slice(0, equal);
      const option = this.options.get(key);
      if (!option)
        throw new CommandInputError('存在未声明的选项；如需把它作为普通文本，请加引号或放在 -- 后');
      if (values.has(option.index)) throw new CommandInputError(`选项重复：--${option.key}`);
      let raw = equal < 0 ? undefined : token.value.slice(equal + 1);
      if (raw === undefined) {
        if (option.type === 'boolean') raw = 'true';
        else {
          const next = tokens[i + 1];
          if (!next || optionLike(next)) throw new CommandInputError(`选项 --${option.key} 缺少值`);
          raw = next.value;
          i++;
        }
      }
      values.set(option.index, convert(raw, option));
    }
    const consumed = new Set<number>();
    for (const parameter of this.parameters) {
      if (parameter.kind === 'arg') {
        values.set(parameter.index, convert(positional[parameter.argument], parameter));
        if (parameter.argument < positional.length) consumed.add(parameter.argument);
      } else if (parameter.kind === 'option' && !values.has(parameter.index))
        values.set(parameter.index, convert(undefined, parameter));
    }
    const slots = this.parameters.filter((parameter) => parameter.kind === 'slot');
    // Evaluate all slot rules for a token before selecting its owner.
    for (let i = 0; i < positional.length; i++) {
      if (consumed.has(i)) continue;
      const value = positional[i]!;
      const candidates = slots.filter((slot) => matches(slot, value));
      if (candidates.length > 1)
        throw new CommandInputError(
          `参数含义不明确，同时匹配：${candidates.map((slot) => slot.name).join('、')}`,
        );
      const slot = candidates[0];
      if (!slot) continue;
      if (values.has(slot.index))
        throw new CommandInputError(`${slot.name} 收到了多个匹配值，请只保留一个`);
      values.set(slot.index, value);
      consumed.add(i);
    }
    for (const slot of slots)
      if (!values.has(slot.index)) {
        if (slot.required) throw new CommandInputError(`缺少必填参数：${slot.name}`);
        values.set(slot.index, slot.default);
      }
    const remaining = positional.filter((_, index) => !consumed.has(index));
    const rest = this.parameters.find((parameter) => parameter.kind === 'rest');
    if (rest) values.set(rest.index, remaining);
    else if (remaining.length) throw new CommandInputError('存在未识别的参数，请检查命令用法');
    const bound = this.parameters.map((parameter) =>
      parameter.kind === 'context'
        ? context
        : parameter.kind === 'args'
          ? [...args]
          : values.get(parameter.index),
    );
    return this.bindAttachments(bound, attachments);
  }

  private bindAttachments(values: unknown[], attachments: readonly Attachment[]): unknown[] {
    for (const [index, parameter] of this.parameters.entries()) {
      if (parameter.kind !== 'attachments') continue;
      const selected = selectAttachments(attachments, parameter.selection);
      if (selected.length < parameter.minCount)
        throw new CommandInputError(
          `${parameter.name}数量不能少于 ${parameter.minCount}（收到 ${selected.length}）；请与命令在同一条消息中发送。`,
        );
      if (parameter.maxCount !== undefined && selected.length > parameter.maxCount)
        throw new CommandInputError(
          `${parameter.name}数量不能超过 ${parameter.maxCount}（收到 ${selected.length}）。`,
        );
      values[index] = selected;
    }
    return values;
  }

  help(): { usage: string; details: string[] } {
    const rank = (p: CompiledParameter) =>
      p.kind === 'arg' ? 0 : p.kind === 'slot' ? 1 : p.kind === 'option' ? 2 : 3;
    const ordered = [...this.parameters].sort(
      (a, b) =>
        rank(a) - rank(b) ||
        (a.kind === 'arg' && b.kind === 'arg' ? a.argument - b.argument : a.index - b.index),
    );
    return {
      usage: [
        ...ordered
          .filter((p) => p.kind !== 'attachments')
          .map(usage)
          .filter(Boolean),
        ...(!this.enhanced && ordered.some((p) => p.kind === 'args') ? ['[参数...]'] : []),
        ...ordered.filter((p) => p.kind === 'attachments').map(usage),
      ].join(' '),
      details: ordered.flatMap((parameter) => {
        if (
          parameter.kind === 'context' ||
          parameter.kind === 'args' ||
          parameter.kind === 'identity'
        )
          return [];
        const parts = [
          parameter.kind === 'option'
            ? `--${parameter.key}${parameter.alias ? ` / -${parameter.alias}` : ''}（${parameter.name}）`
            : parameter.name,
        ];
        if (parameter.description) parts.push(parameter.description);
        if (parameter.kind === 'attachments') {
          parts.push(
            parameter.minCount > 0 ? '必填' : '可选',
            `附件类型：${attachmentLabels[parameter.selection]}`,
            `最少 ${parameter.minCount} 个`,
            parameter.maxCount === undefined ? '数量无上限' : `最多 ${parameter.maxCount} 个`,
            '与命令在同一条消息中发送，不占文字参数',
          );
        } else if (parameter.kind === 'rest') parts.push('可填写多个补充内容，保持输入顺序');
        else {
          parts.push(parameter.required ? '必填' : '可选');
          if (parameter.kind === 'slot') parts.push('按规则匹配，顺序不限');
          else parts.push(typeLabels[parameter.type]);
          if (parameter.default !== undefined)
            parts.push(`默认 ${JSON.stringify(parameter.default)}`);
          if (parameter.choices) parts.push(`可选值 ${parameter.choices.join(' / ')}`);
          if (parameter.kind !== 'slot') {
            if (parameter.min !== undefined) parts.push(`最小 ${parameter.min}`);
            if (parameter.max !== undefined) parts.push(`最大 ${parameter.max}`);
          }
        }
        return [`${parts.join('；')}`];
      }),
    };
  }
}
