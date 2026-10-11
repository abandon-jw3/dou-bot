import * as runtime from '../src/index.js';
import type * as Contract from '../docs/public-api.js';

// The actual exports must satisfy the approved public declaration draft.
// Separate declaration files necessarily give unique symbols different nominal identities.
type ContractShape = Omit<typeof Contract, 'LOGGER'> & { LOGGER: symbol };
const publicApi: ContractShape = runtime;
void publicApi;

export function readCapacity(snapshot: runtime.ApplicationSnapshot): number {
  const used: number = snapshot.capacity.replyScopes.size;
  const rejected: number = snapshot.rejections.queueFull;
  const wait: number = snapshot.timing.queueWait.totalMs;
  // @ts-expect-error Capacity fields contain counts, not message identities.
  void snapshot.capacity.replyScopes.messageIds;
  // @ts-expect-error Timing is cumulative; percentiles require separate sampling.
  void snapshot.timing.processing.p95;
  return used + rejected + wait;
}

const contextText = runtime.createContextKey<string>('text');
const contextNumber = runtime.createContextKey<number>('number');
runtime.ContextValue(contextText);
const contextMiddleware: runtime.ContextMiddleware = {
  async prepare(ctx) {
    ctx.state.set(contextText, 'ready');
    ctx.state.provide(contextNumber, async (signal) => {
      signal.throwIfAborted();
      await Promise.resolve();
      return 1;
    });
    const value: number = await ctx.state.get(contextNumber);
    void value;
    if (ctx.scene === 'group') void ctx.groupId;
    if (ctx.kind === 'attachment') void ctx.matchedAttachments;
    // @ts-expect-error Middleware does not send messages.
    void ctx.reply;
    // @ts-expect-error Keys retain invariant value types.
    ctx.state.set(contextText, 1);
    // @ts-expect-error Lazy values must agree with the key type.
    ctx.state.provide(contextNumber, () => 'wrong');
  },
};
void contextMiddleware;
runtime.Module({ middlewares: ['middleware'] });
runtime.UseMiddleware('middleware');
// @ts-expect-error Tokens can only be created by the factory.
runtime.ContextValue({});
// @ts-expect-error Providers are selected by tokens, not instances.
runtime.UseMiddleware(contextMiddleware);
// @ts-expect-error Context Key values are invariant.
const wrongContextKey: runtime.ContextKey<string | number> = contextText;
void wrongContextKey;
function readContext(ctx: runtime.MessageContext, raw: runtime.QQEventContext): Promise<string> {
  const result: Promise<string> = ctx.state.get(contextText);
  // @ts-expect-error Only middleware can register values.
  void ctx.state.set;
  // @ts-expect-error Raw observers do not receive route context data.
  void raw.state;
  // @ts-expect-error The context data facade is readonly.
  ctx.state = { get: () => Promise.reject(new Error('readonly fixture')) };
  return result;
}
void readContext;

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
runtime.Slot('server', {
  choices: ['梦江南', '双梦'],
  normalize: (text) => (text === '双梦' ? '梦江南' : text),
});
runtime.Slot('server', { match: (text) => text === '双梦', default: '双梦', normalize: () => '' });
runtime.Rest({ name: '补充内容' });
const attachmentOptions: runtime.AttachmentOptions = { name: '素材', minCount: 1, maxCount: 4 };
runtime.Attachments(attachmentOptions);
runtime.Images(attachmentOptions);
// @ts-expect-error Unreleased command-only video binding was removed.
void runtime.Videos;
// @ts-expect-error Audio uses explicit prompt plus selectAttachments.
void runtime.Audios;
// @ts-expect-error File collection is not a command parameter decorator.
void runtime.Files;
// @ts-expect-error Attachment counts are numeric.
runtime.Images({ minCount: '1' });
// @ts-expect-error Cardinality uses minCount, not a second required flag.
runtime.Attachments({ required: true });
// @ts-expect-error Media selection belongs to the decorator, not an ad-hoc MIME option.
runtime.Images({ contentType: 'image/png' });
const selectionOptions: runtime.AttachmentSelectionOptions = {
  kind: 'video',
  minCount: 1,
  maxCount: 1,
};
const selection: runtime.AttachmentSelectionResult = runtime.selectAttachments(
  [],
  selectionOptions,
);
const kind: runtime.AttachmentKind = 'file';
void kind;
if (selection.status === 'valid') {
  const attachments: readonly runtime.Attachment[] = selection.attachments;
  void attachments;
  // @ts-expect-error Selection arrays are readonly.
  selection.attachments[0] = { url: 'unused', raw: {} };
} else {
  const reason: 'too-few' | 'too-many' = selection.reason;
  const count: number = selection.count;
  const limit: number = selection.limit;
  void [reason, count, limit];
  // @ts-expect-error Invalid results do not expose a partial selection.
  void selection.attachments;
  // @ts-expect-error Result fields are readonly.
  selection.count = 0;
}
// @ts-expect-error Public kinds are explicit categories, not MIME values.
runtime.selectAttachments([], { kind: 'image/png' });
// @ts-expect-error Counts are numeric.
runtime.selectAttachments([], { minCount: '1' });
// @ts-expect-error Selection does not take decorator help metadata.
runtime.selectAttachments([], { name: '文件' });
// @ts-expect-error Raw QQ attachments must first be normalized.
runtime.selectAttachments([{ url: 'unused', content_type: 'voice' }]);
function inspectAttachments(attachments: readonly runtime.Attachment[]): void {
  const voice = attachments[0];
  const wav: string | undefined = voice?.voiceWavUrl;
  const text: string | undefined = voice?.asrReferText;
  void [wav, text];
  // @ts-expect-error Injected attachment arrays are readonly.
  attachments[0] = { url: 'https://example.invalid/image.png', raw: {} };
  if (voice) {
    // @ts-expect-error Voice metadata is readonly, like the rest of Attachment.
    voice.voiceWavUrl = 'https://example.invalid/other.wav';
  }
}
void inspectAttachments;
const identityDecorators: ParameterDecorator[] = [
  runtime.User(),
  runtime.UserId(),
  runtime.Group(),
  runtime.GroupId(),
  runtime.Role(),
];
void identityDecorators;
// @ts-expect-error Identity bindings do not take field selectors.
runtime.User('id');
// @ts-expect-error Missing groups remain undefined; access rules belong to guards.
runtime.Group({ required: true });
// @ts-expect-error Role injection takes no options.
runtime.Role({ default: 'member' });
// @ts-expect-error IDs are read from the event, not supplied to the decorator.
runtime.UserId('user');
// @ts-expect-error Group IDs are not configurable.
runtime.GroupId({});
function inspectIdentity(user: runtime.UserInfo, group: runtime.GroupInfo | undefined): void {
  const id: string = user.id;
  const username: string | undefined = user.username;
  const bot: boolean | undefined = user.bot;
  const role: runtime.GroupRole | undefined = user.memberRole;
  const groupId: string | undefined = group?.id;
  void [id, username, bot, role, groupId];
  // @ts-expect-error Identity snapshots are readonly.
  user.id = 'changed';
  // @ts-expect-error Profiles are readonly too.
  user.username = 'changed';
  // @ts-expect-error An unavailable role cannot be assumed to be a known role.
  const requiredRole: runtime.GroupRole = user.memberRole;
  void requiredRole;
  // @ts-expect-error The current event does not provide a complete group profile.
  void group?.name;
  // @ts-expect-error Additional platform fields remain accessible through Ctx.raw.
  void user.unionOpenId;
  if (group) {
    // @ts-expect-error Group snapshots are readonly.
    group.id = 'changed';
  }
}
void inspectIdentity;
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
// @ts-expect-error Normalization does not replace a matching rule.
runtime.Slot('server', { normalize: (text: string) => text });
// @ts-expect-error Slot normalization is synchronous.
runtime.Slot('server', { choices: ['双梦'], normalize: () => Promise.resolve('梦江南') });
// @ts-expect-error Slot normalization returns a string, not an entity.
runtime.Slot('server', { choices: ['双梦'], normalize: () => ({ name: '梦江南' }) });
// @ts-expect-error Undefined is reserved for an absent optional Slot.
runtime.Slot('server', { choices: ['双梦'], normalize: () => undefined });
// @ts-expect-error Normalization is only available on Slot.
runtime.Arg(0, { normalize: (text: string) => text });
// @ts-expect-error Options retain their existing conversion rules.
runtime.Option('server', { normalize: (text: string) => text });
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
  else if (ctx.kind === 'button') void ctx.buttonId;
  else {
    void ctx.matchedAttachments;
    void ctx.content;
    // @ts-expect-error Attachment guards are message guards.
    void ctx.buttonId;
  }
  if (ctx.scene === 'group') void ctx.groupId;
}
void inspectGuardContext;

runtime.GroupOnly({ message: false });
runtime.PrivateOnly();
runtime.UsersOnly(['openid'], { scene: 'group', groupId: 'group' });
runtime.GroupRoles('owner', 'admin');
runtime.GroupManagersOnly({ message: '仅群管理者' });
runtime.button.callback('manage', '管理', '', { permission: { type: 'managers' } });
// @ts-expect-error QQ group roles are not arbitrary application role names.
runtime.GroupRoles('superuser');
// @ts-expect-error OpenIDs are strings, not numeric QQ account numbers.
runtime.UsersOnly([123]);
// @ts-expect-error The SDK does not support channel scope.
runtime.UsersOnly(['u'], { scene: 'channel' });
// @ts-expect-error There is no native owner-only button permission.
runtime.button.callback('owner', '群主', '', { permission: { type: 'owner' } });
function inspectGroupRole(ctx: runtime.MessageContext): void {
  if (ctx.scene === 'group') {
    const role: runtime.GroupRole | undefined = ctx.memberRole;
    void role;
  } else {
    // @ts-expect-error Private messages have no group role.
    void ctx.memberRole;
  }
}
void inspectGroupRole;

const promptConfig: runtime.PromptConfig = {
  timeoutMs: 60000,
  maxPending: 1000,
  maxTimeoutMs: 300000,
  cancelWords: ['取消'],
};
void promptConfig;
function inspectPrompt(
  ctx: runtime.MessageContext,
  button: runtime.ButtonContext,
  result: runtime.PromptResult,
): void {
  const pending: Promise<runtime.PromptResult> = ctx.prompt('问题', {
    timeoutMs: 30000,
    cancelWords: [],
  });
  pending.catch(() => {});
  if (result.status === 'received') {
    const input: runtime.PromptMessage = result.message;
    void input.attachments;
  } else {
    // @ts-expect-error Timeout/cancellation does not provide a fabricated input message.
    void result.message;
  }
  // @ts-expect-error Initial prompt support is limited to message handlers.
  void button.prompt;
  // @ts-expect-error Millisecond duration must be numeric.
  ctx.prompt('问题', { timeoutMs: '30000' }).catch(() => {});
}
void inspectPrompt;

runtime.Module({ guards: ['guard-token', Symbol('guard')] });
runtime.Module({ guards: [] });
// @ts-expect-error Module guards accept provider tokens, not guard instances.
runtime.Module({ guards: [guard] });
// @ts-expect-error Apply built-in guard decorators to the module class instead.
runtime.Module({ guards: [runtime.GroupOnly()] });

runtime.OnAttachment();
runtime.OnAttachment({
  filename: /^report_\d+\.docx$/i,
  extension: '.docx',
  kind: 'file',
  invalidInput: 'reply',
});
// @ts-expect-error Attachment routes have no command aliases.
runtime.OnAttachment({ aliases: ['doc'] });
// @ts-expect-error Extension is one literal suffix.
runtime.OnAttachment({ extension: ['docx'] });
