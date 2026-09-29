import * as runtime from '../src/index.js';
import type * as Contract from '../docs/public-api.js';

// The actual exports must satisfy the approved public declaration draft.
// Separate declaration files necessarily give unique symbols different nominal identities.
type ContractShape = Omit<typeof Contract, 'LOGGER'> & { LOGGER: symbol };
const publicApi: ContractShape = runtime;
void publicApi;

// Template sending is intentionally absent, including through intermediate variables.
// @ts-expect-error Template builder has been removed.
void runtime.markdownTemplate;
// @ts-expect-error Template keyboard builder has been removed.
void runtime.keyboardTemplate;
const legacyMarkdown = { content: 'raw', custom_template_id: 'old', params: [] };
// @ts-expect-error Template fields cannot be mixed into the supported payload.
const unsupportedMarkdown: runtime.QQMarkdownPayload = legacyMarkdown;
void unsupportedMarkdown;
const legacyKeyboard = { id: 'old', content: { rows: [] } };
// @ts-expect-error Only inline keyboards are supported.
const unsupportedKeyboard: runtime.QQKeyboardPayload = legacyKeyboard;
void unsupportedKeyboard;

// Explicit parameter schemas keep defaults and rules aligned with the declared runtime type.
runtime.Arg(0, { type: 'integer', default: 1, min: 1 });
runtime.Option('detail', { type: 'boolean', alias: 'd', default: false });
runtime.Slot('city', { choices: ['北京'], match: (text) => text.length > 0 });
runtime.Rest({ name: '补充内容' });
// @ts-expect-error Numeric arguments cannot use string defaults.
runtime.Arg(0, { type: 'integer', default: '1' });
// @ts-expect-error String arguments cannot declare numeric bounds.
runtime.Arg(0, { min: 1 });
// @ts-expect-error Boolean options require boolean defaults.
runtime.Option('flag', { type: 'boolean', default: 'false' });
// @ts-expect-error Slots require at least one matching rule.
runtime.Slot('city', {});
// @ts-expect-error Slot matching is synchronous.
runtime.Slot('city', { match: () => Promise.resolve(true) });
// @ts-expect-error Rest injects strings and does not perform scalar conversion.
runtime.Rest({ type: 'number' });

runtime.Cooldown({ scope: 'user', durationMs: 3000, message: false });
const guard: runtime.CanActivate = {
  canActivate: (ctx) => ctx.scene === 'group' || { allow: false, message: '仅限群聊' },
};
void guard;
// @ts-expect-error A guard result uses true to allow, not a permissive object shape.
const invalidGuard: runtime.GuardResult = { allow: true };
void invalidGuard;
// @ts-expect-error Control scopes are explicitly enumerated.
runtime.Cooldown({ scope: 'group', durationMs: 3000 });
// @ts-expect-error Register a provider token rather than a guard instance.
runtime.UseGuards(guard);
function inspectGuardContext(ctx: runtime.GuardContext): void {
  // @ts-expect-error Guards decide admission; they have no reply method.
  void ctx.reply;
  // @ts-expect-error Guards do not acknowledge interactions directly.
  void ctx.ack;
  if (ctx.kind === 'command') void ctx.content;
  else void ctx.buttonId;
  if (ctx.scene === 'group') void ctx.groupId;
}
void inspectGuardContext;
