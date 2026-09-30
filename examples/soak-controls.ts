import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Arg,
  Command,
  Controller,
  Cooldown,
  Ctx,
  FrameworkError,
  Injectable,
  Module,
  Option,
  Rest,
  Slot,
  UseGuards,
} from '../src/index.js';
import type {
  CanActivate,
  ErrorContext,
  GuardContext,
  GuardResult,
  MessageContext,
  QQDispatch,
  QQMessagePayload,
} from '../src/index.js';
import type { Application } from '../src/core/application.js';

type Scene = 'private' | 'group';
type Plan = { scene: Scene; user: string; mode: string };

/** A bounded, credential-free workload shared by the sustained runner and its regression tests. */
export function createControlWorkload() {
  const stats = {
    cycles: 0,
    accepted: 0,
    duplicates: 0,
    moduleDenied: 0,
    classDenied: 0,
    methodDenied: 0,
    parameterErrors: 0,
    queries: 0,
    cooldownDenied: 0,
    promptReceived: 0,
    promptCancelled: 0,
    promptTimeout: 0,
    promptSendFailures: 0,
    shutdownCancelled: 0,
    shutdownErrorsReported: 0,
    questionFailuresInjected: 0,
    questionFailuresReported: 0,
  };
  // Each cycle clears its finite request captures and guard traces; do not retain the whole run.
  const sent = new Map<string, QQMessagePayload[]>();
  const trace: string[] = [];
  let sequence = 0;
  let shutdownDone: Promise<void>[] = [];
  const shutdownIds = new Set<string>();
  const guard = (level: 'module' | 'class' | 'method', ctx: GuardContext): GuardResult => {
    trace.push(level);
    if (ctx.kind === 'command' && ctx.content.includes(`${level}-deny`)) {
      stats[`${level}Denied`]++;
      return { allow: false, message: `soak-${level}-denied` };
    }
    return true;
  };
  @Injectable()
  class ModuleGate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      return guard('module', ctx);
    }
  }
  @Injectable()
  class ClassGate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      return guard('class', ctx);
    }
  }
  @Injectable()
  class MethodGate implements CanActivate {
    canActivate(ctx: GuardContext): GuardResult {
      return guard('method', ctx);
    }
  }
  @Controller()
  @UseGuards(ClassGate)
  class Controls {
    @Command('soak-query', { aliases: ['soak-q'] })
    @UseGuards(MethodGate)
    @Cooldown({ scope: 'user', durationMs: 60000, message: 'soak-cooldown' })
    query(
      @Slot('city', { choices: ['北京'], required: true }) city: string,
      @Slot('topic', { choices: ['天气'], required: true }) topic: string,
      @Rest() remaining: string[],
      @Option('page', { type: 'integer', alias: 'p', default: 1 }) page: number,
    ): string {
      stats.queries++;
      return JSON.stringify({ city, topic, remaining, page });
    }

    @Command('soak-ask')
    @UseGuards(MethodGate)
    async ask(@Arg(0) mode: string, @Ctx() ctx: MessageContext): Promise<void> {
      try {
        const first = await ctx.prompt(`soak-question:${mode}:1`, {
          timeoutMs: mode === 'timeout' ? 25 : 30000,
        });
        if (first.status === 'cancelled') {
          stats.promptCancelled++;
          return;
        }
        if (first.status === 'timeout') {
          assert.equal(mode, 'timeout');
          stats.promptTimeout++;
          return;
        }
        assert.equal(mode, 'multi');
        const second = await first.message.prompt('soak-question:multi:2');
        assert.equal(second.status, 'received');
        if (second.status === 'received') {
          stats.promptReceived++;
          await second.message.reply('soak-prompt-finished');
        }
      } catch (error) {
        if (mode === 'send-failure' && error instanceof FrameworkError && error.code === 'QQ_API') {
          stats.promptSendFailures++;
          return;
        }
        if (mode === 'shutdown' && ctx.signal.aborted) {
          stats.shutdownCancelled++;
          return;
        }
        throw error;
      }
    }
  }
  @Module({
    controllers: [Controls],
    providers: [ModuleGate, ClassGate, MethodGate],
    guards: [ModuleGate],
  })
  class ControlModule {}

  function message(content: string, scene: Scene, user: string): QQDispatch {
    const id = `soak-control-${++sequence}`;
    return scene === 'group'
      ? {
          op: 0,
          t: 'GROUP_MESSAGE_CREATE',
          d: { id, group_openid: 'control-group', author: { member_openid: user }, content },
        }
      : { op: 0, t: 'C2C_MESSAGE_CREATE', d: { id, author: { user_openid: user }, content } };
  }
  function enqueue(app: Application, event: QQDispatch, duplicate = false) {
    const bytes = Buffer.byteLength(JSON.stringify(event));
    const admission = app.execution.accept(event, bytes);
    assert.equal(admission.status, 'accepted');
    assert.ok('done' in admission);
    stats.accepted++;
    if (duplicate) {
      const repeated = app.execution.accept(event, bytes);
      assert.equal(repeated.status, 'duplicate');
      assert.ok('done' in repeated);
      assert.equal(repeated.done, admission.done);
      stats.duplicates++;
    }
    return admission.done;
  }
  const idOf = (event: QQDispatch) => (event.d as { id: string }).id;
  async function until(predicate: () => boolean, signal: AbortSignal) {
    const deadline = performance.now() + 5000;
    while (!predicate()) {
      signal.throwIfAborted();
      assert.ok(performance.now() < deadline, 'Control workload made no progress within 5 seconds');
      await delay(1, undefined, { signal });
    }
  }
  async function cycle(app: Application, signal: AbortSignal): Promise<void> {
    sent.clear();
    trace.length = 0;
    const before = { ...stats };
    const user = `control-user-${stats.cycles}`;
    for (const scene of ['private', 'group'] as const) {
      for (const [content, expected] of [
        ['/soak-query module-deny', ['module']],
        ['/soak-query class-deny', ['module', 'class']],
        ['/soak-query method-deny', ['module', 'class', 'method']],
        ['/soak-query 北京', ['module', 'class', 'method']],
      ] as const) {
        trace.length = 0;
        await enqueue(app, message(content, scene, user));
        assert.deepEqual(trace, [...expected]);
      }
      const query = message('/soak-query 今天 天气 北京 -p 2', scene, user);
      trace.length = 0;
      await enqueue(app, query, true);
      assert.deepEqual(trace, ['module', 'class', 'method']);
      assert.deepEqual(JSON.parse(sent.get(idOf(query))?.[0]?.content ?? 'null'), {
        city: '北京',
        topic: '天气',
        remaining: ['今天'],
        page: 2,
      });
      const alias = message('/soak-q 北京 天气', scene, user);
      await enqueue(app, alias);
      assert.equal(sent.get(idOf(alias))?.[0]?.content, 'soak-cooldown');
      stats.cooldownDenied++;
    }
    const plans: Plan[] = (['private', 'group'] as const).flatMap((scene) =>
      ['multi', 'cancel', 'timeout'].map((mode) => ({ scene, user: `${user}-${mode}`, mode })),
    );
    const questions = plans.map((plan) => ({
      plan,
      event: message(`/soak-ask ${plan.mode}`, plan.scene, plan.user),
    }));
    trace.length = 0;
    const done = questions.map(({ event }) => enqueue(app, event, true));
    await until(() => questions.every(({ event }) => sent.has(idOf(event))), signal);
    const callsAfterQuestions = trace.length;
    for (const { plan } of questions) {
      if (plan.mode === 'timeout') continue;
      // Even command-shaped input must belong to the prompt and must not rerun guards/cooldown.
      const answer = message(
        plan.mode === 'cancel' ? '取消' : '/soak-query 北京 天气',
        plan.scene,
        plan.user,
      );
      done.push(enqueue(app, answer, true));
      if (plan.mode === 'multi') {
        await until(() => sent.get(idOf(answer))?.[0]?.content === 'soak-question:multi:2', signal);
        const final = message('second answer', plan.scene, plan.user);
        done.push(enqueue(app, final, true));
        await until(() => sent.get(idOf(final))?.[0]?.content === 'soak-prompt-finished', signal);
        assert.equal(sent.get(idOf(final))?.[0]?.msg_id, idOf(final));
      }
    }
    await Promise.all(done);
    assert.equal(trace.length, callsAfterQuestions);
    for (const scene of ['private', 'group'] as const)
      await enqueue(app, message('/soak-ask send-failure', scene, `${user}-failure`));
    await app.execution.idle();
    await until(
      () => stats.questionFailuresReported - before.questionFailuresReported === 2,
      signal,
    );
    assert.equal(stats.queries - before.queries, 2);
    assert.equal(stats.parameterErrors - before.parameterErrors, 2);
    assert.equal(stats.promptReceived - before.promptReceived, 2);
    assert.equal(stats.promptCancelled - before.promptCancelled, 2);
    assert.equal(stats.promptTimeout - before.promptTimeout, 2);
    assert.equal(stats.promptSendFailures - before.promptSendFailures, 2);
    assert.equal(app.snapshot().prompts.pending, 0);
    stats.cycles++;
    sent.clear();
    trace.length = 0;
  }
  async function prepareShutdown(app: Application, signal: AbortSignal) {
    sent.clear();
    const events = (['private', 'group'] as const).map((scene) =>
      message('/soak-ask shutdown', scene, 'shutdown-user'),
    );
    for (const event of events) shutdownIds.add(idOf(event));
    shutdownDone = events.map((event) => enqueue(app, event));
    await until(
      () => events.every((event) => sent.has(idOf(event))) && app.snapshot().queue.active === 0,
      signal,
    );
    assert.equal(app.snapshot().prompts.pending, 2);
  }
  return {
    module: ControlModule,
    stats,
    cycle,
    prepareShutdown,
    async verifyShutdown() {
      await Promise.all(shutdownDone);
      assert.equal(stats.shutdownCancelled, 2);
      assert.equal(stats.shutdownErrorsReported, 2);
      shutdownIds.clear();
      sent.clear();
      trace.length = 0;
    },
    respond(path: string, payload: QQMessagePayload): Response | undefined {
      if (!path.endsWith('/messages') || !payload.msg_id?.startsWith('soak-control-')) return;
      const messages = sent.get(payload.msg_id) ?? [];
      messages.push(payload);
      sent.set(payload.msg_id, messages);
      if (payload.content === 'soak-question:send-failure:1') {
        stats.questionFailuresInjected++;
        return Response.json({ code: 100017, message: 'Deliberate control question failure' });
      }
      return Response.json({ id: `control-reply-${sequence}` });
    },
    report(error: Error, context: ErrorContext): boolean {
      if (!context.messageId?.startsWith('soak-control-')) return false;
      if (
        shutdownIds.has(context.messageId) &&
        context.phase === 'prompt' &&
        error instanceof FrameworkError &&
        error.code === 'INVALID_STATE'
      ) {
        stats.shutdownErrorsReported++;
        return true;
      }
      if (error instanceof FrameworkError && error.code === 'PARAMETER_PARSE') {
        stats.parameterErrors++;
        return true;
      }
      if (error instanceof FrameworkError && error.code === 'QQ_API' && context.phase === 'send') {
        stats.questionFailuresReported++;
        return true;
      }
      return false;
    },
  };
}
