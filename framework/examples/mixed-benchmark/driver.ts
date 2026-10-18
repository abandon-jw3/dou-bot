import assert from 'node:assert/strict';
import { Agent, createServer, request } from 'node:http';
import type { ServerResponse } from 'node:http';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  Histogram,
  elapsedMs,
  finishReport,
  event,
  eventId,
  hash,
  makeMeta,
  now,
  parseId,
  record,
  send,
  signedHeaders,
} from './common.js';
import type { Meta, Profile } from './common.js';

/** An independent open-loop sender and downstream service fixture. No external connections. */
export async function runDriver(config: Profile, reportPath: string): Promise<void> {
  const agent = new Agent({ keepAlive: true, maxSockets: Math.min(256, config.driverMaxInFlight) });
  const plans = new Map<number, Meta>();
  const actors = new Set<number>();
  const sequences = new Set<string>();
  const acknowledgements = new Set<string>();
  const acceptedIds = new Set<number>();
  const timers = new Set<NodeJS.Timeout>();
  const responseTimers = new Set<NodeJS.Timeout>();
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  const phases = Array.from({ length: config.phases.length + 1 }, () => ({
    counts: {},
    statuses: {},
    schedulingLag: new Histogram(),
    ackLatency: new Histogram(),
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
  let nextContinuationId = 1_000_000;
  let outstanding = 0;
  let maximumOutstanding = 0;
  let fixtureActive = 0;
  let maximumFixtureActive = 0;
  let tokenActive = 0;
  let maximumTokenActive = 0;
  let tokenCount = 0;
  let faultTokenInjected = false;
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
          if (!stopped) failure(error);
        });
      },
    );
    req.setTimeout(10000, () => req.destroy(new Error('Webhook request timeout')));
    req.on('error', (error) => {
      if (!complete()) return;
      count(phase.counts, 'requestErrors');
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
    const wrong: Meta = {
      ...root,
      id: nextContinuationId++,
      kind: 'distractor',
      root: rootId,
      step,
      userId: `wrong-${rootId}`,
      dueNs: now().toString(),
    };
    submit(wrong, 'distractor');
    later(
      () => {
        if (!actors.has(rootId)) {
          count(counts, 'lateAnswersSkipped');
          return;
        }
        const right: Meta = {
          ...root,
          id: nextContinuationId++,
          kind: 'answer',
          root: rootId,
          step,
          dueNs: now().toString(),
        };
        submit(right, 'answer', true);
      },
      config.name === 'smoke' ? 15 : 60,
    );
  }
  function respond(
    res: ServerResponse,
    status: number,
    payload: unknown,
    delayMs: number,
    after?: () => void,
  ): void {
    const timer = setTimeout(() => {
      responseTimers.delete(timer);
      if (res.destroyed) return;
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(status === 204 ? undefined : JSON.stringify(payload), after);
    }, delayMs);
    responseTimers.add(timer);
    res.once('close', () => {
      clearTimeout(timer);
      responseTimers.delete(timer);
    });
  }
  const fixture = createServer((req, res) => {
    fixtureActive++;
    maximumFixtureActive = Math.max(maximumFixtureActive, fixtureActive);
    res.once('close', () => {
      fixtureActive--;
      if (!res.writableEnded) count(counts, 'abortedFixtureRequests');
    });
    const handle = async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of req) {
        const buffer = Buffer.from(chunk as Uint8Array);
        bytes += buffer.length;
        assert.ok(bytes <= 2 * 1024 * 1024, 'Fixture request too large');
        chunks.push(buffer);
      }
      const body: unknown = bytes ? JSON.parse(Buffer.concat(chunks).toString()) : {};
      assert.ok(record(body));
      counts.fixtureBytes = (counts.fixtureBytes ?? 0) + bytes;
      if (url.pathname === '/app/getAppAccessToken') {
        tokenCount++;
        tokenActive++;
        maximumTokenActive = Math.max(maximumTokenActive, tokenActive);
        res.once('close', () => {
          tokenActive--;
        });
        const fault = config.phases[phaseOf()]?.faults && !faultTokenInjected;
        if (fault) {
          faultTokenInjected = true;
          count(counts, 'tokenFailuresInjected');
        }
        respond(
          res,
          fault ? 503 : 200,
          fault
            ? { code: 990003, message: 'fixture token failure' }
            : { access_token: `fixture-token-${tokenCount}`, expires_in: config.tokenSeconds },
          config.baseApiMs,
        );
        return;
      }
      if (url.pathname === '/data') {
        const id = Number(url.searchParams.get('id'));
        const phase = Number(url.searchParams.get('phase'));
        const kind = url.searchParams.get('kind');
        count(counts, 'dataRequests');
        let delay = hash(id, 37) % 100 < 5 ? config.slowDataMs : config.baseDataMs;
        if (hash(id, 43) % 1000 < 5) delay = Math.floor(config.loadTimeoutMs * 0.7);
        if (kind === 'large') delay = config.name === 'smoke' ? 50 : 120;
        if (kind === 'hold') delay = 15000;
        if (config.phases[phase]?.faults && id % 11 === 0) {
          delay = config.loadTimeoutMs * 2;
          count(counts, 'dataTimeoutsInjected');
        }
        const userId =
          process.env.DOU_BOT_BENCHMARK_CORRUPT_DATA === '1'
            ? 'incorrect-user'
            : url.searchParams.get('user');
        respond(res, 200, { userId, id }, delay);
        return;
      }
      assert.ok(
        /^\/v2\/(groups|users)\/[^/]+\/(messages|files)$/u.test(url.pathname) ||
          /^\/interactions\/[^/]+$/u.test(url.pathname),
        `Unexpected fixture route ${url.pathname}`,
      );
      const interaction = url.pathname.startsWith('/interactions/');
      let reference = parseId(
        interaction
          ? decodeURIComponent(url.pathname.split('/')[2]!)
          : (body.msg_id ?? body.event_id),
      );
      if (url.pathname.endsWith('/files')) {
        assert.equal(typeof body.file_data, 'string');
        const image = Buffer.from(body.file_data as string, 'base64');
        assert.equal(image.length, 65536);
        reference = {
          phase: image.readUInt32BE(image.length - 8),
          id: image.readUInt32BE(image.length - 4),
        };
        count(counts, 'uploads');
      }
      if (!reference && typeof body.content === 'string') {
        const match = /^result:(\d+):button$/u.exec(body.content);
        const plan = match ? plans.get(Number(match[1])) : undefined;
        if (plan) reference = { phase: plan.phase, id: plan.id };
      }
      assert.ok(reference, 'Outgoing request has no accounted origin');
      const meta = plans.get(reference.id);
      assert.ok(meta, 'Outgoing origin is unknown');
      if (interaction) {
        const key = eventId(meta);
        assert.ok(!acknowledgements.has(key), 'Button acknowledged twice');
        acknowledgements.add(key);
        count(counts, 'buttonAcks');
      } else {
        const target =
          meta.scene === 'group' ? `/groups/${meta.groupId}/` : `/users/${meta.userId}/`;
        assert.ok(url.pathname.includes(target), 'Reply crossed a user or group boundary');
        if (body.msg_id !== undefined) {
          assert.equal(typeof body.msg_id, 'string');
          assert.equal(typeof body.msg_seq, 'number');
          const key = `${body.msg_id as string}:${body.msg_seq as number}`;
          assert.ok(!sequences.has(key), 'Reply sequence reused');
          sequences.add(key);
        }
      }
      const fault = config.phases[reference.phase]?.faults;
      let delay = config.baseApiMs;
      let status = interaction ? 204 : 200;
      let result: unknown = url.pathname.endsWith('/files')
        ? { file_info: `fixture-${meta.id}`, ttl: 60 }
        : { id: `sent-${meta.id}`, timestamp: new Date().toISOString() };
      if (fault && meta.id % 13 === 0) {
        status = 429;
        result = { code: 990001, message: 'fixture rate limit' };
        count(counts, 'http429Injected');
      } else if (fault && meta.id % 17 === 0) {
        status = 503;
        result = { code: 990002, message: 'fixture unavailable' };
        count(counts, 'http503Injected');
      } else if (fault && meta.id % 19 === 0) {
        delay = config.requestTimeoutMs * 2;
        count(counts, 'apiTimeoutsInjected');
      }
      count(counts, 'apiRequests');
      const question =
        typeof body.content === 'string'
          ? /^question:(\d+):(\d+):(\d+):(\w+)$/u.exec(body.content)
          : null;
      respond(
        res,
        status,
        result,
        delay,
        status === 200 && question
          ? () =>
              later(
                () => answer(Number(question[2]), Number(question[3])),
                config.name === 'smoke' ? 10 : 40,
              )
          : undefined,
      );
    };
    handle().catch((error) => {
      failure(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve));
  const address = fixture.address();
  assert.ok(address && typeof address !== 'string');
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
      fixtureActive,
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
    const closed = new Promise<void>((resolve) => fixture.close(() => resolve()));
    fixture.closeAllConnections();
    await closed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(responseTimers.size, 0);
    assert.equal(fixtureActive, 0);
    assert.equal(tokenActive, 0);
    await finishReport(
      'driver-final',
      {
        counts,
        errors,
        phases: phases.map((p, index) => ({
          name: config.phases[index]?.name ?? 'shutdown',
          counts: p.counts,
          statuses: p.statuses,
          schedulingLag: p.schedulingLag.snapshot(),
          ackLatency: p.ackLatency.snapshot(),
        })),
        tokenCount,
        maximumTokenActive,
        maximumOutstanding,
        maximumFixtureActive,
        samples,
        cleanup: {
          outstanding,
          fixtureActive,
          responseTimers: responseTimers.size,
          timers: timers.size,
        },
        generatorRetainedMetadata: plans.size,
      },
      reportPath,
    );
    plans.clear();
    sequences.clear();
    acknowledgements.clear();
    actors.clear();
    acceptedIds.clear();
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
    if (message.type === 'snapshot')
      send({
        type: 'driver-snapshot',
        nonce: message.nonce,
        outstanding,
        timers: timers.size,
        fixtureActive,
        actors: actors.size,
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
    origin: `http://127.0.0.1:${address.port}`,
    node: process.version,
    pid: process.pid,
  });
}
