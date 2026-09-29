export interface AppConfig {
  readonly prefix: string;
  readonly privateUsers: readonly string[];
  readonly groups: readonly string[];
  readonly liveEnrollment: boolean;
  readonly requestTimeoutMs: number;
  readonly cacheTtlMs: number;
}

export const CONFIG = Symbol('application config');
export const HTTP_FETCH = Symbol('weather fetch');
export const CLOCK = Symbol('monotonic clock');
export const AUDIT = Symbol('business audit');
export type AuditEvent = Readonly<Record<string, string | number | boolean>>;
export type Audit = (event: AuditEvent) => void;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prefix = env.COMMAND_PREFIX ?? '';
  if (/\s/u.test(prefix)) throw new Error('COMMAND_PREFIX 不能包含空白');
  const list = (value: string | undefined) => [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
  return Object.freeze({
    prefix,
    privateUsers: Object.freeze(list(env.ALLOWED_PRIVATE_USERS)),
    groups: Object.freeze(list(env.ALLOWED_GROUPS)),
    liveEnrollment: false,
    requestTimeoutMs: 8000,
    cacheTtlMs: 60000,
  });
}
