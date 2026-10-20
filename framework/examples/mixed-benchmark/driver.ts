import assert from 'node:assert/strict';
import { Agent, request } from 'node:http';
import type { Socket } from 'node:net';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  Histogram,
  elapsedMs,
  finishReport,
  event,
  hash,
  makeMeta,
  continuationMeta,
  now,
  record,
  send,
  signedHeaders,
} from './common.js';
import type { Meta, Profile } from './common.js';
import { startFixture } from './fixture.js';

/** An independent open-loop sender and downstream service fixture. No external connections. */
export async function runDriver(
  config: Profile,
  reportPath: string,
  externalFixture = false,
): Promise<void> {
  const agent = new Agent({ keepAlive: true, maxSockets: config.driverMaxSockets });
  const plans = new Map<number, Meta>();
  const actors = new Set<number>();
  const acceptedIds = new Set<number>();
  const completedIds = new Set<number>();
  const completed = externalFixture
    ? Array.from({ length: config.phases.length + 1 }, () => ({
        outcomes: {},
        successLatency: new Histogram(),
        terminalLatency: new Histogram(),
        successfulCompletionsByWallTime: 0,
      }))
    : undefined;
  const timers = new Set<NodeJS.Timeout>();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const transportErrors: Record<string, unknown>[] = [];
  const sockets = new WeakMap<Socket, { requests: number; created: bigint }>();
  const phases = Array.from({ length: config.phases.length + 1 }, () => ({
    counts: {},
    statuses: {},
    schedulingLag: new Histogram(),
    ackLatency: new Histogram(),
    socketWait: new Histogram(),
  }));
  const count = (target: Record<string, number>, name: string) => {
    target[name] = (target[name] ?? 0) + 1;
  };
  const failure = (error: unknown) => {
    count(counts, 'unexpected');
    if (errors.length < 20) errors.push(String(error));
  };
  let sdkOrigin = '';
  let startNs: bigint | undefined;
  let nextId = 1;
  let outstanding = 0;
  let maximumOutstanding = 0;
  let stopped = false;
  const phaseOf = () => {
    if (!startNs) return 0;
    let elapsed = elapsedMs(startNs);
    for (let i = 0; i < config.phases.length; i++) {
      elapsed -= config.phases[i]!.durationMs;
      if (elapsed < 0) return i;
    }
    return config.phases.length;
  };
  function later(callback: () => void, milliseconds: number): void {
    const timer = setTimeout(() => {
      timers.delete(timer);
      if (!stopped) callback();
    }, milliseconds);
    timers.add(timer);
  }
  function transmit(meta: Meta, source: string, attempt = 0): void {
    if (stopped) return;
    const phase = phases[meta.phase]!;
    count(phase.counts, source);
    if (outstanding >= config.driverMaxInFlight) {
      count(phase.counts, 'driverDropped');
      count(phase.counts, `driverDropped:${source}`);
      return;
    }
    const body = Buffer.from(JSON.stringify(event(meta)));
    outstanding++;
    maximumOutstanding = Math.max(maximumOutstanding, outstanding);
    const sent = now();
    let socket: Socket | undefined;
    let requestsOnSocket = 0;
    let connected: bigint | undefined;
    let localPort: number | undefined;
    let connectionEstablished = false;
    let readAtAssignment = 0;
    let writtenAtAssignment = 0;
    let finished = false;
    const complete = () => {
      if (finished) return false;
      finished = true;
      outstanding--;
      return true;
    };
    const req = request(
      `${sdkOrigin}/qq`,
      { method: 'POST', headers: signedHeaders(body), agent },
      (response) => {
        response.resume();
        response.on('end', () => {
          if (!complete()) return;
          const status = response.statusCode ?? 0;
          count(
            phase.counts,
            response.headers.connection === 'close' ? 'connectionClose' : 'connectionReusable',
          );
          count(phase.statuses, String(status));
          if (status === 200 && !acceptedIds.has(meta.id)) {
            acceptedIds.add(meta.id);
            count(
              phase.counts,
              ['answer', 'distractor'].includes(meta.kind)
                ? 'continuationsAcknowledged'
                : 'primaryAcknowledged',
            );
          }
          phase.ackLatency.add(elapsedMs(sent));
          if (status === 503 && attempt < 2 && !stopped)
            later(() => transmit(meta, 'retry', attempt + 1), 100 * (attempt + 1));
          else if (![200, 503].includes(status)) failure(`Unexpected webhook status ${status}`);
        });
        response.on('error', (error) => {
          if (!complete()) return;
          count(phase.counts, 'responseErrors');
          traceTransportError('response', error);
          if (!stopped) failure(error);
        });
      },
    );
    const traceTransportError = (source: string, error: NodeJS.ErrnoException) => {
      count(phase.counts, `transportError:${error.code ?? error.name}`);
      if (transportErrors.length >= 20) return;
      transportErrors.push({
        source,
        phase: config.phases[meta.phase]?.name ?? 'shutdown',
        id: meta.id,
        attempt,
        code: error.code,
        syscall: error.syscall,
        message: error.message,
        elapsedMs: elapsedMs(sent),
        reusedSocket: req.reusedSocket,
        connectionEstablished,
        requestsOnSocket,
        localPort,
        socketAgeMs: connected === undefined ? undefined : elapsedMs(connected),
        bodyBytes: body.length,
        requestFinished: req.writableFinished,
        readBytes: socket === undefined ? undefined : socket.bytesRead - readAtAssignment,
        writtenBytes: socket === undefined ? undefined : socket.bytesWritten - writtenAtAssignment,
      });
    };
    req.once('socket', (assigned: Socket) => {
      phase.socketWait.add(elapsedMs(sent));
      socket = assigned;
      const info = sockets.get(assigned) ?? { requests: 0, created: now() };
      if (!sockets.has(assigned)) {
        sockets.set(assigned, info);
        count(counts, 'connections');
      }
      requestsOnSocket = ++info.requests;
      connected = info.created;
      readAtAssignment = assigned.bytesRead;
      writtenAtAssignment = assigned.bytesWritten;
      localPort = assigned.localPort;
      connectionEstablished = !assigned.connecting && assigned.remotePort !== undefined;
      if (assigned.connecting)
        assigned.once('connect', () => {
          localPort = assigned.localPort;
          connectionEstablished = true;
        });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Webhook request timeout')));
    req.on('error', (error) => {
      if (!complete()) return;
      count(phase.counts, 'requestErrors');
      traceTransportError('request', error);
      if (!stopped) failure(error);
    });
    req.end(body);
  }
  function submit(meta: Meta, source: string, duplicate = false): void {
    plans.set(meta.id, meta);
    if (meta.kind === 'prompt' || meta.kind === 'shutdown-prompt') actors.add(meta.id);
    transmit(meta, source);
    if (duplicate) later(() => transmit(meta, 'duplicate'), 25);
  }
  function answer(rootId: number, step: number): void {
    const root = plans.get(rootId);
    assert.ok(root);
    if (!actors.has(rootId)) {
      count(counts, 'lateAnswersSkipped');
      return;
    }
    if (root.promptMode === 'timeout' || root.promptMode === 'shutdown') return;
    const wrong = continuationMeta(root, step, false, now());
    submit(wrong, 'distractor');
    later(
      () => {
        if (!actors.has(rootId)) {
          count(counts, 'lateAnswersSkipped');
          return;
        }
        const right = continuationMeta(root, step, true, now());
        submit(right, 'answer', true);
      },
      config.name === 'smoke' ? 15 : 60,
    );
  }
  const fixture = externalFixture
    ? undefined
    : await startFixture(config, {
        plan: (id) => plans.get(id),
        phaseOf,
        question: (root, step) =>
          later(() => answer(root, step), config.name === 'smoke' ? 10 : 40),
      });
  let scheduler: NodeJS.Timeout | undefined;
  function begin(at: bigint): void {
    assert.equal(startNs, undefined);
    startNs = at;
    let index = 0,
      issued = 0,
      phaseStart = at;
    const pump = () => {
      if (stopped) return;
      let quota = 256;
      while (index < config.phases.length && quota > 0) {
        const phase = config.phases[index]!;
        const total = Math.floor((phase.durationMs * phase.rate) / 1000);
        if (issued >= total) {
          if (now() < phaseStart + BigInt(phase.durationMs) * 1_000_000n) break;
          index++;
          issued = 0;
          phaseStart += BigInt(phase.durationMs) * 1_000_000n;
          send({ type: 'phase', index, name: config.phases[index]?.name ?? 'drain' });
          continue;
        }
        const due = phaseStart + BigInt(Math.floor((issued * 1e9) / phase.rate));
        if (now() < due) break;
        phases[index]!.schedulingLag.add(elapsedMs(due));
        const meta = makeMeta(nextId++, index, due, config);
        submit(meta, 'primary', hash(meta.id, 113) % 20 === 0);
        issued++;
        quota--;
      }
      if (index === config.phases.length) {
        send({ type: 'load-finished' });
        return;
      }
      scheduler = setTimeout(pump, quota ? 5 : 0);
    };
    pump();
  }
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const samples: Record<string, unknown>[] = [];
  let cpuBefore = process.cpuUsage(),
    sampleAt = now();
  const sampler = setInterval(() => {
    const cpu = process.cpuUsage(cpuBefore);
    cpuBefore = process.cpuUsage();
    const elapsed = elapsedMs(sampleAt);
    sampleAt = now();
    samples.push({
      atNs: now().toString(),
      phase: phaseOf(),
      memory: process.memoryUsage(),
      outstanding,
      agentPending: Object.values(agent.requests).reduce(
        (sum, queued) => sum + (queued?.length ?? 0),
        0,
      ),
      fixtureActive: fixture?.activity().fixtureActive ?? 0,
      cpuCores: (cpu.user + cpu.system) / (elapsed * 1000),
      eventLoopP99Ms: loop.percentile(99) / 1e6,
    });
    loop.reset();
  }, 1000);
  const finish = async () => {
    stopped = true;
    if (scheduler) clearTimeout(scheduler);
    clearInterval(sampler);
    loop.disable();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    agent.destroy();
    const fixtureResult = await fixture?.close();
    await finishReport(
      'driver-final',
      {
        counts: Object.fromEntries(
          [...new Set([...Object.keys(counts), ...Object.keys(fixtureResult?.counts ?? {})])].map(
            (key) => [key, (counts[key] ?? 0) + (fixtureResult?.counts[key] ?? 0)],
          ),
        ),
        errors: [...errors, ...(fixtureResult?.errors ?? [])].slice(0, 20),
        transportErrors,
        phases: phases.map((p, index) => ({
          name: config.phases[index]?.name ?? (externalFixture ? 'drain' : 'shutdown'),
          counts: p.counts,
          statuses: p.statuses,
          schedulingLag: p.schedulingLag.snapshot(),
          ackLatency: p.ackLatency.snapshot(),
          socketWait: p.socketWait.snapshot(),
          ...(completed
            ? {
                outcomes: completed[index]!.outcomes,
                successLatency: completed[index]!.successLatency.snapshot(),
                terminalLatency: completed[index]!.terminalLatency.snapshot(),
                successfulCompletionsByWallTime: completed[index]!.successfulCompletionsByWallTime,
              }
            : {}),
        })),
        tokenCount: fixtureResult?.tokenCount ?? 0,
        maximumTokenActive: fixtureResult?.maximumTokenActive ?? 0,
        maximumOutstanding,
        maximumFixtureActive: fixtureResult?.maximumFixtureActive ?? 0,
        samples,
        cleanup: {
          outstanding,
          fixtureActive: fixture?.activity().fixtureActive ?? 0,
          responseTimers: fixtureResult?.cleanup.responseTimers ?? 0,
          timers: timers.size,
        },
        generatorRetainedMetadata: plans.size,
        ...(externalFixture
          ? {
              issuedIds: [...plans.keys()],
              completedPrimary: completedIds.size,
              latencyOrigin: 'driver-scheduled-to-completion-notification',
            }
          : {}),
      },
      reportPath,
    );
    plans.clear();
    actors.clear();
    acceptedIds.clear();
    completedIds.clear();
    process.disconnect?.();
  };
  process.on('message', (message: unknown) => {
    if (!record(message)) return;
    if (message.type === 'clock')
      send({ type: 'clock', nonce: message.nonce, atNs: now().toString() });
    if (message.type === 'configure') {
      assert.equal(typeof message.origin, 'string');
      sdkOrigin = message.origin as string;
    }
    if (message.type === 'begin') {
      assert.equal(typeof message.startNs, 'string');
      begin(BigInt(message.startNs as string));
    }
    if (message.type === 'root-done') actors.delete(Number(message.id));
    if (message.type === 'question')
      later(
        () => answer(Number(message.root), Number(message.step)),
        config.name === 'smoke' ? 10 : 40,
      );
    if (message.type === 'completion') {
      assert.ok(completed);
      const id = Number(message.id);
      const plan = plans.get(id);
      assert.ok(
        plan && !['answer', 'distractor'].includes(plan.kind),
        'Completion has no offered primary',
      );
      assert.equal(message.phase, plan.phase);
      assert.equal(completedIds.has(id), false, 'Primary completed twice');
      assert.equal(typeof message.outcome, 'string');
      completedIds.add(id);
      const data = completed[plan.phase]!;
      count(data.outcomes, message.outcome as string);
      data.terminalLatency.add(elapsedMs(plan.dueNs));
      if (message.outcome === 'success') {
        data.successLatency.add(elapsedMs(plan.dueNs));
        completed[phaseOf()]!.successfulCompletionsByWallTime++;
      }
    }
    if (message.type === 'snapshot')
      send({
        type: 'driver-snapshot',
        nonce: message.nonce,
        outstanding,
        timers: timers.size,
        fixtureActive: fixture?.activity().fixtureActive ?? 0,
        actors: actors.size,
        completedPrimary: completedIds.size,
      });
    if (message.type === 'shutdown-prompts')
      for (let i = 0; i < Math.min(8, config.concurrency); i++)
        submit(
          makeMeta(nextId++, config.phases.length, now(), config, 'shutdown-prompt'),
          'shutdown',
        );
    if (message.type === 'shutdown-holds')
      for (let i = 0; i < config.concurrency + 8; i++)
        submit(makeMeta(nextId++, config.phases.length, now(), config, 'hold'), 'shutdown');
    if (message.type === 'finish')
      finish().catch((error) => {
        console.error(error);
        process.exitCode = 1;
      });
  });
  process.once('disconnect', () => {
    if (!stopped)
      finish().catch(() => {
        process.exitCode = 1;
      });
  });
  send({
    type: 'driver-ready',
    ...(fixture ? { origin: fixture.origin } : {}),
    node: process.version,
    pid: process.pid,
  });
}
