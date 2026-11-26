import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setImmediate as tick } from 'node:timers/promises';
import WebSocket from 'ws';
import { Application } from '../../src/core/application.js';
import { createBenchmarkDatabase } from './database.js';
import { FrameworkError, QQApiError } from '../../src/index.js';
import { CountingClock } from '../soak-support.js';
import {
  accountIds,
  accountFor,
  secret,
  Histogram,
  elapsedMs,
  finishReport,
  metadata,
  now,
  parseId,
  record,
  send,
} from './common.js';
import type { Meta, Profile } from './common.js';
import type { ErrorContext, DiagnosticsSpan } from '../../src/index.js';
import { workload } from './workload.js';
import { DiagnosticsTimeline } from './diagnostics.js';
import { auditReports } from './error-audit.js';
import { applicationResources, assertApplicationReleased } from './resources.js';

interface Entry {
  meta: Meta;
  admitted: bigint;
  started?: bigint;
  routes: Set<string>;
  success: Set<string>;
  loads: number;
  errors: number;
  intentional: boolean;
  parameterError: boolean;
  operational: boolean;
  missedPrompt?: boolean;
  promptLimit?: boolean;
}
const bits: Record<string, number> = {
  query: 1,
  admin: 2,
  images: 4,
  file: 8,
  audit: 16,
  button: 32,
  picture: 64,
  prompt: 128,
  failure: 256,
  hold: 512,
};
export async function runSdk(
  config: Profile,
  fixture: string,
  reportPath: string,
  distributed = false,
  gatewayOrigin?: string,
): Promise<void> {
  const entries = new Map<number, Entry>();
  const seen = new Uint16Array(2_000_000);
  const received = new Uint8Array(2_000_000);
  const groups = new Set<string>();
  const globalCounts: Record<string, number> = {};
  const unexpected: { message: string; code?: string; id?: number }[] = [];
  let exportedSpans = 0;
  const traceExamples: DiagnosticsSpan[] = [];
  const totals = Array.from({ length: config.phases.length + 1 }, () => ({
    admissions: {},
    primaryAdmissions: {},
    receivedPrimary: 0,
    outcomes: {},
    kinds: {},
    routes: {},
    successfulCompletionsByWallTime: 0,
    loads: 0,
    errors: {},
    queue: new Histogram(),
    successLatency: new Histogram(),
    terminalLatency: new Histogram(),
  }));
  const byBot = Object.fromEntries(
    accountIds(config).map((id) => [
      id,
      Array.from({ length: config.phases.length + 1 }, () => ({
        admissions: {},
        primaryAdmissions: {},
        receivedPrimary: 0,
        primaryOutcomes: {},
      })),
    ]),
  );
  const stoppingAccounts = new Set<string>();
  const controls: Record<string, unknown>[] = [];
  let startNs: bigint | undefined;
  let closing = false;
  let closeTask: Promise<void> | undefined;
  let maximumEntries = 0;
  const count = (target: Record<string, number>, key: string) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  const phaseOf = () => {
    if (!startNs) return 0;
    let elapsed = elapsedMs(startNs);
    for (let i = 0; i < config.phases.length; i++) {
      elapsed -= config.phases[i]!.durationMs;
      if (elapsed < 0) return i;
    }
    return config.phases.length;
  };
  const failure = (message: string, id?: number) => {
    count(globalCounts, 'unexpected');
    if (unexpected.length < 20) unexpected.push({ message, ...(id === undefined ? {} : { id }) });
  };
  const current = (meta: Meta): Entry => {
    const entry = entries.get(meta.id);
    assert.ok(entry, 'Execution was not accounted at admission');
    return entry;
  };
  const clock = new CountingClock();
  const database = await createBenchmarkDatabase(config, clock, () =>
    failure('Database idle connection failed'),
  );
  const root = workload(config, fixture, {
    ...(database.readUser ? { readUser: database.readUser } : {}),
    start(meta) {
      const entry = current(meta);
      if (entry.started === undefined) {
        entry.started = now();
        totals[meta.phase]!.queue.add(Number(entry.started - entry.admitted) / 1e6);
      }
    },
    load(meta) {
      current(meta).loads++;
      totals[meta.phase]!.loads++;
    },
    handler(meta, route) {
      const bit = bits[route];
      assert.ok(bit !== undefined);
      assert.ok(meta.id < seen.length, 'Fixture identifier exceeded bound');
      assert.equal(seen[meta.id]! & bit, 0, 'Handler executed twice for the same event and route');
      seen[meta.id]! |= bit;
      const entry = current(meta);
      entry.routes.add(route);
      count(totals[meta.phase]!.routes, route);
    },
    success(meta, route) {
      current(meta).success.add(route);
    },
    prompt(meta, outcome) {
      count(globalCounts, `prompt:${outcome}`);
      if (!closing && outcome !== meta.promptMode) current(meta).missedPrompt = true;
    },
    intentionalError(meta) {
      current(meta).intentional = true;
    },
    isClosing: () => closing,
  });
  const auditError = (error: Error, context: ErrorContext): void => {
    const parsed = parseId(context.eventId) ?? parseId(context.messageId);
    const entry = parsed ? entries.get(parsed.id) : undefined;
    const code = error instanceof FrameworkError ? error.code : error.name;
    count(globalCounts, `error:${code}`);
    if (entry) {
      entry.errors++;
      count(totals[entry.meta.phase]!.errors, code);
    }
    if (error.name === 'AssertionError') failure(error.message, parsed?.id);
    else if (entry?.intentional) count(globalCounts, 'intentionalBusinessErrors');
    else if (closing) count(globalCounts, 'shutdownErrors');
    else if (context.appId && stoppingAccounts.has(context.appId))
      count(globalCounts, 'accountStopErrors');
    else if (code === 'PARAMETER_PARSE' && entry?.meta.kind === 'badargs')
      entry.parameterError = true;
    else if (code === 'RESOURCE_LIMIT' && entry?.meta.kind === 'prompt') {
      entry.promptLimit = true;
      count(globalCounts, 'promptResourceLimits');
    } else if (
      error instanceof QQApiError &&
      [990001, 990002, 990003].includes(Number(error.qqCode))
    ) {
      if (entry) entry.operational = true;
      count(globalCounts, 'injectedHttpErrors');
    } else if (code === 'DATABASE') {
      if (entry) entry.operational = true;
      count(globalCounts, 'databaseErrors');
    } else if (code === 'TRANSPORT' || code === 'CONTEXT_TIMEOUT') {
      if (entry) entry.operational = true;
      count(globalCounts, 'operationalTimeouts');
    } else failure(error.message, parsed?.id);
  };
  const setupFailed = async (error: unknown): Promise<never> => {
    await database.finish().catch(() => {});
    throw error;
  };
  const app = await Application.create(
    root,
    {
      database: database.options,
      webhook: { listen: false },
      bots: accountIds(config).map((appId) => ({
        appId,
        secret,
        transport:
          config.transport === 'ws'
            ? { type: 'ws', gatewayUrl: gatewayOrigin! }
            : {
                type: 'webhook',
                path: config.bots === 2 ? `/qq/${appId}` : '/qq',
                maxBodyBytes: 256 * 1024,
                maxConcurrentRequests: 256,
              },
        api: { requestTimeoutMs: config.requestTimeoutMs },
      })),
      execution: {
        concurrency: config.concurrency,
        queueCapacity: config.queueCapacity,
        queueMaxBytes: config.queueMaxBytes,
        maxEventBytes: 128 * 1024,
        dedupMaxEntries: 50000,
        replyScopeMaxEntries: 200000,
        shutdownTimeoutMs: config.shutdownTimeoutMs,
      },
      outbound: { concurrency: config.outboundConcurrency },
      diagnostics: {
        enabled: config.diagnostics === 'metrics' || config.diagnostics === 'sampled',
        traceSampleRate: config.diagnostics === 'sampled' ? 0.01 : 0,
        maxActiveSpans: 8192,
        onSpans(spans) {
          exportedSpans += spans.length;
          for (const span of spans) if (traceExamples.length < 80) traceExamples.push(span);
        },
      },
      prompts: { maxPending: 512, timeoutMs: config.promptTimeoutMs, maxTimeoutMs: 20000 },
      context: { loadTimeoutMs: config.loadTimeoutMs, prepareTimeoutMs: 2000 },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
      onError(_error, context) {
        count(globalCounts, 'errorCallbacks');
        const parsed = parseId(context.eventId) ?? parseId(context.messageId);
        if (parsed && !entries.has(parsed.id)) count(globalCounts, 'lateErrorCallbacks');
      },
    },
    {
      clock,
      persistence: database.persistence,
      socketFactory(url, options) {
        const id = String(options.headers?.['X-Union-Appid']);
        instrument(id);
        return new WebSocket(url, options);
      },
      fetch(input, init) {
        const original = new URL(
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        );
        return fetch(new URL(original.pathname + original.search, fixture), init);
      },
    },
  ).catch(setupFailed);
  await app.initialize().catch(setupFailed);
  const instrumented = new WeakSet<object>();
  const instrument = (appId: string) => {
    const runtime = app.runtime(appId);
    const execution = runtime.execution;
    if (instrumented.has(execution)) return;
    instrumented.add(execution);
    auditReports(runtime.reporter, auditError);
    const originalAccept = execution.accept.bind(execution);
    execution.accept = (payload, bytes, observation) => {
      const meta = metadata(payload);
      if (!meta) return originalAccept(payload, bytes, observation);
      assert.equal(accountFor(meta, config), appId, 'Event crossed an account boundary');
      assert.ok(meta.phase >= 0 && meta.phase < totals.length);
      assert.ok(meta.id >= 0 && meta.id < received.length);
      const primary = !['answer', 'distractor'].includes(meta.kind);
      const bot = byBot[appId]![meta.phase]!;
      if (primary && !received[meta.id]) {
        received[meta.id] = 1;
        totals[meta.phase]!.receivedPrimary++;
        bot.receivedPrimary++;
      }
      const hadEntry = entries.has(meta.id);
      const entry: Entry = entries.get(meta.id) ?? {
        meta,
        admitted: now(),
        routes: new Set(),
        success: new Set(),
        loads: 0,
        errors: 0,
        intentional: false,
        parameterError: false,
        operational: false,
      };
      if (!hadEntry) entries.set(meta.id, entry);
      maximumEntries = Math.max(maximumEntries, entries.size);
      const result = originalAccept(payload, bytes, observation);
      count(totals[meta.phase]!.admissions, result.status);
      count(bot.admissions, result.status);
      if (primary) {
        count(totals[meta.phase]!.primaryAdmissions, result.status);
        count(bot.primaryAdmissions, result.status);
      }
      if (result.status !== 'accepted') {
        if (!hadEntry) entries.delete(meta.id);
        return result;
      }
      count(totals[meta.phase]!.kinds, meta.kind);
      if (meta.scene === 'group' && !['answer', 'distractor'].includes(meta.kind))
        groups.add(meta.groupId);
      result.done
        .then(() => {
          const phase = totals[meta.phase]!;
          let outcome: string;
          if (['answer', 'distractor'].includes(meta.kind)) outcome = 'continuation';
          else if (
            closing &&
            (meta.kind === 'hold' || meta.kind === 'shutdown-prompt' || !entry.success.size)
          )
            outcome = 'shutdown-cancelled';
          else if (entry.parameterError) outcome = 'invalid-input';
          else if (entry.intentional) outcome = 'intentional-business-error';
          else if (stoppingAccounts.has(appId)) outcome = 'account-stopped';
          else if (entry.promptLimit) outcome = 'prompt-resource-limit';
          else if (entry.operational) outcome = 'operational-error';
          else if (entry.missedPrompt) outcome = 'prompt-deadline-missed';
          else if (
            meta.kind === 'admin' &&
            (meta.scene !== 'group' || meta.role === 'member') &&
            !entry.routes.size &&
            !entry.loads
          )
            outcome = 'guard-denied';
          else {
            const expected = meta.kind === 'file' ? 2 : 1;
            if (
              entry.errors ||
              entry.success.size !== expected ||
              entry.loads !== (meta.kind === 'failure' ? 0 : expected)
            ) {
              failure(
                `Outcome mismatch: ${meta.kind}; successful handlers=${entry.success.size}; loads=${entry.loads}; errors=${entry.errors}`,
                meta.id,
              );
              outcome = 'unexpected';
            } else {
              outcome = 'success';
              phase.successLatency.add(elapsedMs(distributed ? entry.admitted : meta.dueNs));
              totals[phaseOf()]!.successfulCompletionsByWallTime++;
            }
          }
          count(phase.outcomes, outcome);
          if (primary) count(bot.primaryOutcomes, outcome);
          if (!['answer', 'distractor'].includes(meta.kind))
            phase.terminalLatency.add(elapsedMs(distributed ? entry.admitted : meta.dueNs));
          if (distributed && !['answer', 'distractor'].includes(meta.kind))
            send({ type: 'completion', id: meta.id, phase: meta.phase, outcome });
          entries.delete(meta.id);
          if (['prompt', 'shutdown-prompt'].includes(meta.kind))
            send({ type: 'root-done', id: meta.id });
        })
        .catch((error) =>
          failure(error instanceof Error ? error.message : 'Completion rejected', meta.id),
        );
      return result;
    };
  };
  for (const id of accountIds(config)) instrument(id);
  const httpCounts: Record<string, number> = {};
  const httpErrors: Record<string, unknown>[] = [];
  const handler = config.transport === 'ws' ? undefined : app.webhookHandler();
  const http = createServer((request, response) => {
    count(httpCounts, 'requests');
    response.once('finish', () => {
      count(httpCounts, `status:${response.statusCode}`);
      if (!response.shouldKeepAlive) {
        count(httpCounts, 'connectionClose');
        count(
          httpCounts,
          request.complete ? 'closeAfterCompleteRequest' : 'closeBeforeCompleteRequest',
        );
      }
    });
    response.once('close', () => {
      if (!response.writableFinished) count(httpCounts, 'unfinishedResponses');
    });
    assert.ok(handler);
    handler(request, response);
  });
  http.on('connection', (socket) => {
    count(httpCounts, 'connections');
    const remotePort = socket.remotePort;
    socket.once('timeout', () => {
      count(httpCounts, 'socketTimeouts');
    });
    socket.once('error', (error: NodeJS.ErrnoException) => {
      count(httpCounts, `socketError:${error.code ?? error.name}`);
      if (httpErrors.length < 20)
        httpErrors.push({
          remotePort,
          code: error.code,
          message: error.message,
          bytesRead: socket.bytesRead,
          bytesWritten: socket.bytesWritten,
        });
    });
  });
  http.requestTimeout = 10000;
  http.headersTimeout = 5000;
  const eventLoop = monitorEventLoopDelay({ resolution: 10 });
  eventLoop.enable();
  const diagnosticsTimeline = new DiagnosticsTimeline(
    app.diagnostics,
    config.diagnostics === 'metrics' || config.diagnostics === 'sampled',
  );
  const diagnosticPhase = () =>
    startNs === undefined || now() < startNs
      ? 'setup'
      : (config.phases[phaseOf()]?.name ?? 'drain');
  const samples: Record<string, unknown>[] = [];
  let cpuBefore = process.cpuUsage();
  let sampledAt = now();
  const sample = (forceDiagnostics = false) => {
    const cpu = process.cpuUsage(cpuBefore);
    cpuBefore = process.cpuUsage();
    const elapsed = Number(now() - sampledAt) / 1e6;
    sampledAt = now();
    const memory = process.memoryUsage();
    const resources = applicationResources(app, clock);
    // Already-admitted prompt owners rejoin the waiting queue without a new capacity check.
    // The nominal queue capacity governs new work, not these bounded continuations.
    assert.ok(
      resources.pending <= config.queueCapacity + 512 &&
        resources.active <= config.concurrency &&
        resources.retainedBytes <= config.queueMaxBytes,
      JSON.stringify(resources),
    );
    const row = {
      atNs: now().toString(),
      elapsedMs: elapsed,
      phase: phaseOf(),
      memory,
      resources,
      snapshot: app.snapshot(),
      outbound: app.outgoing.snapshot(),
      cpuCores: elapsed ? (cpu.user + cpu.system) / (elapsed * 1000) : 0,
      eventLoopP99Ms: eventLoop.percentile(99) / 1e6,
      eventLoopMaxMs: eventLoop.max / 1e6,
      auditEntries: entries.size,
    };
    eventLoop.reset();
    samples.push(row);
    if (samples.length > 1200) samples.shift();
    diagnosticsTimeline.capture(diagnosticPhase(), forceDiagnostics);
    return row;
  };
  const sampler = setInterval(() => {
    try {
      sample();
    } catch (error) {
      failure(String(error));
    }
  }, 1000);
  const close = (): Promise<void> => {
    if (closeTask) return closeTask;
    closing = true;
    closeTask = (async () => {
      if (sampler) clearInterval(sampler);
      const before = sample(true);
      const closed = new Promise<void>((resolve) => http.close(() => resolve()));
      let closeError: { code: string; message: string } | undefined;
      try {
        await app.close();
      } catch (error) {
        if (!(error instanceof FrameworkError) || error.code !== 'SHUTDOWN_TIMEOUT') throw error;
        closeError = { code: error.code, message: error.message };
      } finally {
        http.closeAllConnections();
        await closed;
      }
      await tick();
      const databaseReport = await database.finish();
      assertApplicationReleased(app, clock);
      diagnosticsTimeline.capture('closed', true);
      eventLoop.disable();
      global.gc?.();
      assert.equal(entries.size, 0, 'Accounting entries retained');
      await finishReport(
        'sdk-final',
        {
          beforeClose: before,
          closeError,
          final: applicationResources(app, clock),
          snapshot: app.snapshot(),
          database: databaseReport,
          outbound: app.outgoing.snapshot(),
          byBot,
          controls,
          diagnostics: {
            snapshot: app.diagnostics.snapshot(),
            exportedSpans,
            traceExamples,
            timeline: diagnosticsTimeline.report(),
          },
          afterCloseMemory: process.memoryUsage(),
          resourceUsage: process.resourceUsage(),
          globalCounts,
          httpCounts,
          httpErrors,
          unexpected,
          maximumEntries,
          groups: groups.size,
          latencyOrigin: distributed ? 'server-admission' : 'scheduled-arrival',
          samples,
          phases: totals.map((p, index) => ({
            name: config.phases[index]?.name ?? 'shutdown',
            admissions: p.admissions,
            primaryAdmissions: p.primaryAdmissions,
            receivedPrimary: p.receivedPrimary,
            outcomes: p.outcomes,
            kinds: p.kinds,
            routes: p.routes,
            loads: p.loads,
            errors: p.errors,
            successfulCompletionsByWallTime: p.successfulCompletionsByWallTime,
            queueWait: p.queue.snapshot(),
            successLatency: p.successLatency.snapshot(),
            terminalLatency: p.terminalLatency.snapshot(),
          })),
        },
        reportPath,
      );
      process.disconnect?.();
    })();
    return closeTask;
  };
  process.on('message', (message: unknown) => {
    if (!record(message)) return;
    if (message.type === 'clock')
      send({ type: 'clock', nonce: message.nonce, atNs: now().toString() });
    if (message.type === 'begin' && typeof message.startNs === 'string')
      startNs = BigInt(message.startNs);
    if (message.type === 'snapshot')
      send({ type: 'sdk-snapshot', nonce: message.nonce, data: sample() });
    if (message.type === 'close')
      close().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
    if (message.type === 'bot-control') {
      const action = async () => {
        const id = String(message.appId);
        assert.ok(config.transport === 'ws' && accountIds(config).includes(id));
        assert.ok(message.action === 'stop' || message.action === 'start');
        const entry: Record<string, unknown> = {
          appId: id,
          action: message.action,
          startedNs: now().toString(),
        };
        controls.push(entry);
        if (message.action === 'stop') {
          stoppingAccounts.add(id);
          await app.bots
            .get(id)
            .stop()
            .catch((error: unknown) => {
              if (!(error instanceof FrameworkError) || error.code !== 'SHUTDOWN_TIMEOUT')
                throw error;
              entry.deadlineReached = true;
            });
          const snapshot = app.runtime(id).snapshot();
          assert.equal(
            snapshot.queue.active + snapshot.queue.pending + snapshot.prompts.pending,
            0,
          );
        } else {
          await app.bots.get(id).start();
          stoppingAccounts.delete(id);
        }
        entry.finishedNs = now().toString();
        entry.status = app.bots.get(id).status;
        send({ type: 'bot-controlled', nonce: message.nonce, ...entry });
      };
      void action().catch((error: unknown) => {
        failure(String(error));
        send({ type: 'bot-controlled', nonce: message.nonce, error: String(error) });
      });
    }
  });
  process.once('disconnect', () => {
    if (!closing)
      close().catch(() => {
        process.exitCode = 1;
      });
  });
  await app.start().catch(setupFailed);
  if (config.transport !== 'ws')
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
  const address = http.address();
  assert.ok(config.transport === 'ws' || (address && typeof address !== 'string'));
  global.gc?.();
  sample();
  send({
    type: 'sdk-ready',
    ...(address && typeof address !== 'string'
      ? { origin: `http://127.0.0.1:${address.port}` }
      : {}),
    node: process.version,
    pid: process.pid,
    concurrency: app.snapshot().inbound.concurrency,
    outboundConcurrency: app.outgoing.snapshot().concurrency,
  });
}
