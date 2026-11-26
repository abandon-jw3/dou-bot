import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { ServerResponse } from 'node:http';
import { accountFor, eventId, hash, parseId, record } from './common.js';
import type { Meta, Profile } from './common.js';

export interface FixtureHooks {
  plan(id: number): Meta | undefined;
  phaseOf(): number;
  question(root: number, step: number): void;
}

/** Same real-clock HTTP fixture for local and distributed measurements. */
export async function startFixture(config: Profile, hooks: FixtureHooks) {
  const responseTimers = new Set<NodeJS.Timeout>();
  const sequences = new Set<string>();
  const acknowledgements = new Set<string>();
  const references = new Set<number>();
  const responses = new Set<ServerResponse>();
  let responsesDrained: (() => void) | undefined;
  const counts: Record<string, number> = {};
  const errors: string[] = [];
  let fixtureActive = 0,
    maximumFixtureActive = 0;
  let tokenActive = 0,
    maximumTokenActive = 0,
    tokenCount = 0;
  let faultTokenInjected = false;
  let closing = false;
  const count = (target: Record<string, number>, key: string) => {
    target[key] = (target[key] ?? 0) + 1;
  };
  const failure = (error: unknown) => {
    count(counts, 'unexpected');
    if (errors.length < 20) errors.push(String(error));
  };
  function respond(
    res: ServerResponse,
    status: number,
    payload: unknown,
    delayMs: number,
    after?: () => void,
  ): void {
    if (closing || res.destroyed) return;
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
    responses.add(res);
    maximumFixtureActive = Math.max(maximumFixtureActive, fixtureActive);
    res.once('close', () => {
      fixtureActive--;
      responses.delete(res);
      if (!res.writableEnded) count(counts, 'abortedFixtureRequests');
      if (closing && responses.size === 0) {
        responsesDrained?.();
        responsesDrained = undefined;
      }
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
        const fault = config.phases[hooks.phaseOf()]?.faults && !faultTokenInjected;
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
        const plan = match ? hooks.plan(Number(match[1])) : undefined;
        if (plan) reference = { phase: plan.phase, id: plan.id };
      }
      assert.ok(reference, 'Outgoing request has no accounted origin');
      const meta = hooks.plan(reference.id);
      assert.ok(meta, 'Outgoing origin is unknown');
      assert.equal(reference.phase, meta.phase, 'Outgoing origin phase changed');
      if (config.transport !== undefined)
        assert.equal(
          req.headers['x-union-appid'],
          accountFor(meta, config),
          'Reply used the wrong bot credentials',
        );
      references.add(meta.id);
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
          ? () => hooks.question(Number(question[2]), Number(question[3]))
          : undefined,
      );
    };
    handle().catch((error) => {
      if (closing) return;
      failure(error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    fixture.once('error', reject);
    fixture.listen(0, '127.0.0.1', () => {
      fixture.off('error', reject);
      resolve();
    });
  });
  const address = fixture.address();
  assert.ok(address && typeof address !== 'string');
  const snapshot = () => ({
    counts: { ...counts },
    errors: [...errors],
    references: [...references],
    tokenCount,
    maximumTokenActive,
    maximumFixtureActive,
    cleanup: { fixtureActive, tokenActive, responseTimers: responseTimers.size },
  });
  let closeTask: Promise<ReturnType<typeof snapshot>> | undefined;
  return {
    origin: `http://127.0.0.1:${address.port}`,
    activity: () => ({ fixtureActive, tokenActive, responseTimers: responseTimers.size }),
    snapshot,
    close() {
      closeTask ??= (async () => {
        closing = true;
        for (const timer of responseTimers) clearTimeout(timer);
        responseTimers.clear();
        const drained = new Promise<void>((resolve) => {
          if (responses.size === 0) resolve();
          else responsesDrained = resolve;
        });
        const closed = new Promise<void>((resolve) => fixture.close(() => resolve()));
        for (const response of responses) response.destroy();
        fixture.closeAllConnections();
        await Promise.all([closed, drained]);
        assert.equal(responseTimers.size, 0);
        assert.equal(fixtureActive, 0);
        assert.equal(tokenActive, 0);
        const result = snapshot();
        sequences.clear();
        acknowledgements.clear();
        references.clear();
        return result;
      })();
      return closeTask;
    },
  };
}
