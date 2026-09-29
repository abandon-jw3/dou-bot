import { CommandInputError } from './input-error.js';

export interface ParsedCommand {
  name: string;
  args: string[];
}

export interface ArgumentToken {
  value: string;
  /** The token starts with a quote or escape, so it cannot introduce an option. */
  literal: boolean;
}

export function parseCommand(content: string, prefix: string): ParsedCommand | null {
  const parsed = tokenizeCommand(content, prefix);
  return parsed && { name: parsed.name, args: parsed.tokens.map((token) => token.value) };
}

export function tokenizeCommand(
  content: string,
  prefix: string,
): { name: string; tokens: ArgumentToken[] } | null {
  const input = content.trimStart();
  if (!input.startsWith(prefix)) return null;
  const body = input.slice(prefix.length);
  const name = /^\S+/.exec(body)?.[0];
  if (!name) return null;
  const tokens: ArgumentToken[] = [];
  let value = '';
  let quote: string | undefined;
  let escaped = false;
  let started = false;
  let literal = false;
  for (const char of body.slice(name.length)) {
    if (escaped) {
      value += char;
      escaped = false;
      started = true;
      continue;
    }
    if (char === '\\') {
      if (!started) literal = true;
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = undefined;
      else value += char;
      continue;
    }
    if (char === '"' || char === "'") {
      if (!started) literal = true;
      quote = char;
      started = true;
      continue;
    }
    if (/\s/u.test(char)) {
      if (started) {
        tokens.push({ value, literal });
        value = '';
        started = false;
        literal = false;
      }
    } else {
      value += char;
      started = true;
    }
  }
  if (quote || escaped)
    throw new CommandInputError(
      '引号未闭合或末尾存在未完成的转义（Unclosed quote or trailing escape）',
    );
  if (started) tokens.push({ value, literal });
  return { name, tokens };
}
