import assert from 'node:assert/strict';
import {
  Arg,
  Attachments,
  Command,
  ContextValue,
  Controller,
  Ctx,
  GroupId,
  GroupManagersOnly,
  Images,
  Injectable,
  Module,
  OnAttachment,
  OnButton,
  Option,
  Rest,
  Role,
  Slot,
  UserId,
  UseGuards,
  createContextKey,
  image,
} from '../../src/index.js';
import type {
  Attachment,
  ButtonContext,
  CanActivate,
  ContextMiddleware,
  GroupRole,
  GuardContext,
  MessageContext,
  MiddlewareContext,
  QQDispatch,
} from '../../src/index.js';
import { accountFor, metadata, record } from './common.js';
import type { Meta, Profile } from './common.js';

export interface Hooks {
  start(meta: Meta): void;
  load(meta: Meta): void;
  readUser?(meta: Meta, appId: string, signal: AbortSignal): Promise<void>;
  handler(meta: Meta, route: string): void;
  success(meta: Meta, route: string): void;
  prompt(meta: Meta, result: string): void;
  intentionalError(meta: Meta): void;
  isClosing(): boolean;
}
const metaOf = (raw: QQDispatch): Meta => {
  const value = metadata(raw);
  assert.ok(value, 'Fixture metadata missing');
  return value;
};
interface UserData {
  userId: string;
  id: number;
}
const USER = createContextKey<UserData>('mixed.user');
export function workload(config: Profile, fixture: string, hooks: Hooks) {
  const requestData = async (
    ctx: MiddlewareContext,
    meta: Meta,
    signal: AbortSignal,
  ): Promise<UserData> => {
    hooks.load(meta);
    if (hooks.readUser) await hooks.readUser(meta, ctx.appId, signal);
    const url = new URL('/data', fixture);
    url.search = new URLSearchParams({
      id: String(meta.id),
      phase: String(meta.phase),
      user: ctx.userId,
      kind: meta.kind,
    }).toString();
    const response = await fetch(url, { signal });
    assert.equal(response.status, 200);
    const result: unknown = await response.json();
    assert.ok(
      record(result) && result.userId === ctx.userId && result.id === meta.id,
      'Isolated context data changed',
    );
    return { userId: ctx.userId, id: meta.id };
  };
  @Injectable()
  class Prepare implements ContextMiddleware {
    prepare(ctx: MiddlewareContext): void {
      const meta = metaOf(ctx.raw);
      hooks.start(meta);
      ctx.state.provide(USER, (signal) => requestData(ctx, meta, signal));
    }
  }
  @Injectable()
  class Access implements CanActivate {
    async canActivate(ctx: GuardContext): Promise<boolean> {
      const meta = metaOf(ctx.raw);
      if (meta.kind === 'query' && meta.id % 2 === 0) {
        const data = await ctx.state.get(USER);
        assert.equal(data.id, meta.id);
      }
      return true;
    }
  }
  function verify(ctx: MessageContext | ButtonContext, data: UserData): Meta {
    const meta = metaOf(ctx.raw);
    assert.equal(data.id, meta.id);
    assert.equal(data.userId, ctx.userId);
    assert.equal(ctx.userId, meta.userId);
    assert.equal(ctx.scene, meta.scene);
    assert.equal(ctx.appId, accountFor(meta, config));
    if (ctx.scene === 'group') assert.equal(ctx.target.groupId, meta.groupId);
    return meta;
  }
  async function reply(ctx: MessageContext, route: string, data: UserData): Promise<void> {
    const meta = verify(ctx, data);
    hooks.handler(meta, route);
    const sent = await ctx.reply(`result:${meta.id}:${route}`);
    assert.equal(sent.status, 'sent');
    hooks.success(meta, route);
  }
  @Controller()
  @UseGuards(Access)
  class Commands {
    @Command('query')
    async query(
      @Arg(0, { type: 'integer', required: true }) id: number,
      @Slot('server', {
        choices: ['梦江南', '双梦'],
        required: true,
        normalize: (text) => (text === '双梦' ? '梦江南' : text),
      })
      server: string,
      @Option('page', { type: 'integer', required: true }) page: number,
      @Rest() tail: string[],
      @ContextValue(USER) data: UserData,
      @ContextValue(USER) second: UserData,
      @UserId() userId: string,
      @GroupId() groupId: string | undefined,
      @Role() role: GroupRole | undefined,
      @Ctx() ctx: MessageContext,
    ): Promise<void> {
      const meta = verify(ctx, data);
      assert.equal(id, meta.id);
      assert.equal(server, '梦江南');
      assert.equal(page, 2);
      assert.equal(data, second);
      assert.equal(data, await ctx.state.get(USER));
      assert.equal(userId, meta.userId);
      assert.equal(groupId, meta.scene === 'group' ? meta.groupId : undefined);
      assert.equal(role, meta.scene === 'group' ? meta.role : undefined);
      assert.equal(tail[0]?.length, meta.kind === 'large' ? 65536 : 4);
      if (meta.id % 31 === 0) {
        const deadline = performance.now() + (config.name === 'smoke' ? 0.2 : 3);
        while (performance.now() < deadline) {
          /* controlled synchronous CPU work */
        }
      }
      await reply(ctx, 'query', data);
    }
    @Command('admin')
    @GroupManagersOnly({ message: false })
    async admin(@Ctx() ctx: MessageContext, @ContextValue(USER) data: UserData): Promise<void> {
      assert.equal(ctx.scene, 'group');
      assert.ok(ctx.scene === 'group' && ['owner', 'admin'].includes(ctx.memberRole ?? ''));
      await reply(ctx, 'admin', data);
    }
    @Command('images')
    async images(
      @Arg(0) id: string,
      @Images({ minCount: 1, maxCount: 4 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
      @ContextValue(USER) data: UserData,
    ): Promise<void> {
      const meta = verify(ctx, data);
      assert.equal(Number(id), meta.id);
      assert.equal(files.length, 1 + (meta.id % 4));
      assert.ok(Object.isFrozen(files));
      await reply(ctx, 'images', data);
    }
    @OnAttachment({ extension: 'docx' })
    async file(
      @Attachments({ minCount: 1, maxCount: 1 }) files: readonly Attachment[],
      @Ctx() ctx: MessageContext,
      @ContextValue(USER) data: UserData,
    ): Promise<void> {
      assert.equal(files[0]?.filename, `report-${metaOf(ctx.raw).id}.docx`);
      await reply(ctx, 'file', data);
    }
    @OnAttachment({ kind: 'file' })
    async audit(@Ctx() ctx: MessageContext, @ContextValue(USER) data: UserData): Promise<void> {
      await reply(ctx, 'audit', data);
    }
    @OnButton('mixed:button')
    async button(@Ctx() ctx: ButtonContext, @ContextValue(USER) data: UserData): Promise<void> {
      const meta = verify(ctx, data);
      hooks.handler(meta, 'button');
      assert.equal(ctx.data, String(meta.id));
      await ctx.ack();
      const result = await ctx.send(`result:${meta.id}:button`);
      assert.equal(result.status, 'sent');
      hooks.success(meta, 'button');
    }
    @Command('picture')
    async picture(@Ctx() ctx: MessageContext, @ContextValue(USER) data: UserData): Promise<void> {
      const meta = verify(ctx, data);
      hooks.handler(meta, 'picture');
      const bytes = Buffer.alloc(65536);
      bytes.writeUInt32BE(meta.phase, bytes.length - 8);
      bytes.writeUInt32BE(meta.id, bytes.length - 4);
      const result = await ctx.reply(image(bytes));
      assert.equal(result.status, 'sent');
      hooks.success(meta, 'picture');
    }
    @Command('failure')
    failure(@Ctx() ctx: MessageContext): void {
      const meta = metaOf(ctx.raw);
      hooks.handler(meta, 'failure');
      hooks.intentionalError(meta);
      throw new Error('Deliberate mixed workload failure');
    }
    @Command('hold')
    async hold(@Ctx() ctx: MessageContext, @ContextValue(USER) data: UserData): Promise<void> {
      await reply(ctx, 'hold', data);
    }
    @Command('prompt')
    async prompt(@Ctx() ctx: MessageContext, @ContextValue(USER) data: UserData): Promise<void> {
      const meta = verify(ctx, data);
      hooks.handler(meta, 'prompt');
      const question = (step: number) =>
        `question:${meta.phase}:${meta.id}:${step}:${meta.promptMode}`;
      const timeoutMs = meta.promptMode === 'shutdown' ? 20000 : config.promptTimeoutMs;
      const first = await ctx.prompt(question(1), { timeoutMs });
      if (hooks.isClosing()) {
        hooks.prompt(meta, 'shutdown-cancelled');
        return;
      }
      if (first.status !== 'received') {
        if (first.status === 'cancelled') assert.equal(meta.promptMode, 'cancelled');
        hooks.prompt(meta, first.status);
        if (first.status === meta.promptMode) hooks.success(meta, 'prompt');
        return;
      }
      assert.equal(meta.promptMode, 'received');
      assert.equal(first.message.userId, meta.userId);
      assert.equal(first.message.content, `/answer-${meta.id}-1`);
      assert.equal(first.message.scene, meta.scene);
      if (first.message.scene === 'group') assert.equal(first.message.groupId, meta.groupId);
      assert.equal(data, await ctx.state.get(USER));
      const second = await first.message.prompt(question(2), { timeoutMs });
      if (hooks.isClosing()) {
        hooks.prompt(meta, 'shutdown-cancelled');
        return;
      }
      if (second.status !== 'received') {
        hooks.prompt(meta, second.status);
        return;
      }
      if (second.status === 'received') {
        assert.equal(second.message.userId, meta.userId);
        assert.equal(second.message.content, `/answer-${meta.id}-2`);
        await second.message.reply(`result:${meta.id}:prompt`);
        hooks.prompt(meta, 'received');
        hooks.success(meta, 'prompt');
      }
    }
  }
  @Module({ controllers: [Commands], providers: [Prepare, Access], middlewares: [Prepare] })
  class Root {}
  return Root;
}
