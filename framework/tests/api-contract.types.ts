import * as runtime from '../src/index.js';
import type * as Contract from '../docs/public-api.js';

// The actual exports must satisfy the public declaration contract.
type ContractShape = Omit<typeof Contract, 'LOGGER'> & { LOGGER: symbol };
const publicApi: ContractShape = runtime;
void publicApi;

// Diagnostics: readonly batches/snapshots and closed stage vocabulary.
const diagnosticOptions: runtime.DiagnosticsOptions = {
  enabled: true,
  traceSampleRate: 0.01,
  onSpans(spans, signal) {
    signal.throwIfAborted();
    // @ts-expect-error Export batches are readonly.
    spans[0] = spans[0]!;
    if (spans[0]) {
      // @ts-expect-error Trace identifiers cannot be mutated.
      spans[0].traceId = 'modified';
    }
  },
};
void diagnosticOptions;
// @ts-expect-error Stage names are a fixed framework vocabulary.
const customStage: runtime.DiagnosticsStage = 'business.any-user-value';
void customStage;
function readDiagnostics(app: runtime.Application): number {
  const snapshot = app.diagnostics.snapshot();
  // @ts-expect-error Snapshot metrics are readonly.
  snapshot.metrics[0] = snapshot.metrics[0]!;
  return snapshot.activeSpans;
}
void readDiagnostics;

// Transport options: webhook fields cannot leak into WS options.
// @ts-expect-error Webhook verification deadlines are not WS options.
const wsVerificationOptions: runtime.WsTransportOptions = { type: 'ws', verifyTimeoutMs: 1000 };
void wsVerificationOptions;

// Context middleware & ContextKey invariance.
const contextText = runtime.createContextKey<string>('text');
const contextNumber = runtime.createContextKey<number>('number');
const contextMiddleware: runtime.ContextMiddleware = {
  prepare(ctx) {
    ctx.state.set(contextText, 'ready');
    ctx.state.provide(contextNumber, async (signal) => {
      signal.throwIfAborted();
      await Promise.resolve();
      return 1;
    });
    // @ts-expect-error Middleware does not send messages.
    void ctx.reply;
    // @ts-expect-error Keys retain invariant value types.
    ctx.state.set(contextText, 1);
    // @ts-expect-error Lazy values must agree with the key type.
    ctx.state.provide(contextNumber, () => 'wrong');
  },
};
void contextMiddleware;
// @ts-expect-error Tokens can only be created by the factory.
runtime.ContextValue({});
// @ts-expect-error Providers are selected by tokens, not instances.
runtime.UseMiddleware(contextMiddleware);
// @ts-expect-error Context Key values are invariant.
const wrongContextKey: runtime.ContextKey<string | number> = contextText;
void wrongContextKey;
function readContext(ctx: runtime.MessageContext, raw: runtime.QQEventContext): Promise<string> {
  // @ts-expect-error Only middleware can register values.
  void ctx.state.set;
  // @ts-expect-error Raw observers do not receive route context data.
  void raw.state;
  // @ts-expect-error The context data facade is readonly.
  ctx.state = { get: () => Promise.reject(new Error('readonly fixture')) };
  return ctx.state.get(contextText);
}
void readContext;

// Parameter schemas: type-aligned defaults, bounds, and synchronous Slot rules.
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
// @ts-expect-error Rest injects strings and does not perform scalar conversion.
runtime.Rest({ type: 'number' });

// Attachments & identity snapshots: discriminated results and readonly fields.
const selection: runtime.AttachmentSelectionResult = runtime.selectAttachments([], {
  kind: 'video',
  minCount: 1,
});
if (selection.status === 'valid') {
  // @ts-expect-error Selection arrays are readonly.
  selection.attachments[0] = { url: 'unused', raw: {} };
} else {
  // @ts-expect-error Invalid results do not expose a partial selection.
  void selection.attachments;
  // @ts-expect-error Result fields are readonly.
  selection.count = 0;
}
function inspectIdentity(user: runtime.UserInfo, group: runtime.GroupInfo | undefined): void {
  // @ts-expect-error Identity snapshots are readonly.
  user.id = 'changed';
  // @ts-expect-error An unavailable role cannot be assumed to be a known role.
  const requiredRole: runtime.GroupRole = user.memberRole;
  void requiredRole;
  if (group) {
    // @ts-expect-error Group snapshots are readonly.
    group.id = 'changed';
  }
}
void inspectIdentity;

// Guards & access control: narrow GuardContext, explicit scopes, scene narrowing.
const guard: runtime.CanActivate = {
  canActivate: (ctx) => ctx.scene === 'group' || { allow: false, message: '仅限群聊' },
};
// @ts-expect-error A guard result uses true to allow, not a permissive object shape.
const invalidGuard: runtime.GuardResult = { allow: true };
void invalidGuard;
// @ts-expect-error Register a provider token rather than a guard instance.
runtime.UseGuards(guard);
// @ts-expect-error Module guards accept provider tokens, not guard instances.
runtime.Module({ guards: [guard] });
function inspectGuardContext(ctx: runtime.GuardContext): void {
  // @ts-expect-error Guards decide admission; they have no reply method.
  void ctx.reply;
  // @ts-expect-error Guards do not acknowledge interactions directly.
  void ctx.ack;
  if (ctx.kind === 'attachment') {
    // @ts-expect-error Attachment guards are message guards.
    void ctx.buttonId;
  }
}
void inspectGuardContext;
function inspectGroupRole(ctx: runtime.MessageContext): void {
  if (ctx.scene === 'private') {
    // @ts-expect-error Private messages have no group role.
    void ctx.memberRole;
  }
}
void inspectGroupRole;

// Prompts: discriminated result and message-only prompt method.
function inspectPrompt(button: runtime.ButtonContext, result: runtime.PromptResult): void {
  if (result.status !== 'received') {
    // @ts-expect-error Timeout/cancellation does not provide a fabricated input message.
    void result.message;
  }
  // @ts-expect-error Initial prompt support is limited to message handlers.
  void button.prompt;
}
void inspectPrompt;

// Application & multi-bot options: explicit database, explicit private appId, app-level listener.
function inspectApplication(app: runtime.Application): void {
  // @ts-expect-error There is no implicit first-account client in a shared application.
  void app.client;
  const sender = app.get(runtime.MessageSender);
  // @ts-expect-error Private proactive sending must select an account.
  sender.sendMessage({ scene: 'private', userId: 'u' }, 'x').catch(() => {});
  // @ts-expect-error Context addresses cannot lose the owning account.
  const incomplete: runtime.BotTarget = { scene: 'group', groupId: 'g' };
  void incomplete;
}
void inspectApplication;
// @ts-expect-error Production applications require explicit PostgreSQL configuration.
const noDatabase: runtime.AppOptions = { bots: [{ appId: 'a', secret: 's' }] };
void noDatabase;
const misplacedListener: runtime.BotOptions = {
  appId: 'a',
  secret: 'fixture',
  // @ts-expect-error A listener belongs to the application, not an individual account.
  transport: { type: 'webhook', listen: false },
};
void misplacedListener;
