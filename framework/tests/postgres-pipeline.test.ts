import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  Command,
  ContextValue,
  Controller,
  Ctx,
  Database,
  GroupRoutes,
  Injectable,
  Module,
  createContextKey,
} from '../src/index.js';
import type { ContextMiddleware, MessageContext, MiddlewareContext } from '../src/index.js';
import { Application } from '../src/core/application.js';
import { createFixtures } from '../src/testing/fixtures.js';
import { serve } from './helpers.js';
import { postgresTest, withPostgres } from './postgres-fixture.js';

/** Bounded closed-loop integration coverage, not an arrival-rate capacity benchmark. */
await test(
  'real PostgreSQL shared pipeline isolates two bots across 2000 group slots with slow HTTP',
  { ...postgresTest, timeout: 120000 },
  async (t) =>
    withPostgres(
      async ({ store, options, reports }) => {
        const USER = createContextKey<string>('postgres-fixture.user');
        const errors: Error[] = [];
        let loads = 0;
        let httpCalls = 0;
        let slowCalls = 0;
        const host = await serve((request, response) => {
          const url = new URL(request.url!, 'http://fixture');
          httpCalls++;
          const slow = Number(url.searchParams.get('user')) % 20 === 0;
          if (slow) slowCalls++;
          const timer = setTimeout(
            () => {
              response.setHeader('content-type', 'application/json');
              response.end(JSON.stringify({ user: url.searchParams.get('user') }));
            },
            slow ? 80 : 2,
          );
          response.once('close', () => clearTimeout(timer));
        });
        @Injectable()
        class Prepare implements ContextMiddleware {
          constructor(private readonly database: Database) {}
          prepare(ctx: MiddlewareContext): void {
            ctx.state.provide(USER, async (signal) => {
              loads++;
              // Release the SQL connection before waiting for an external service.
              const result = await this.database.query<{ user: string }>(
                'SELECT $1::text AS "user"',
                [ctx.userId],
              );
              const response = await fetch(`${host.url}/?user=${ctx.userId}`, { signal });
              const value = (await response.json()) as { user: string };
              assert.equal(value.user, result.rows[0]!.user);
              return value.user;
            });
          }
        }
        @Controller()
        class Commands {
          constructor(
            private readonly database: Database,
            private readonly routes: GroupRoutes,
          ) {}
          @Command('lookup')
          async lookup(
            @Ctx() ctx: MessageContext,
            @ContextValue(USER) first: string,
            @ContextValue(USER) second: string,
          ): Promise<void> {
            assert.equal(this.database, store);
            assert.equal(first, ctx.userId);
            assert.equal(second, first);
            assert.equal(ctx.scene, 'group');
            if (ctx.scene !== 'group') throw new Error('Expected group fixture');
            assert.deepEqual(await this.routes.resolve(ctx.target.groupId), ctx.target);
            await ctx.reply(`${ctx.appId}:${first}`);
          }
        }
        @Module({ providers: [Prepare], middlewares: [Prepare], controllers: [Commands] })
        class Root {}
        const fixture = createFixtures({});
        const app = await Application.create(
          Root,
          {
            database: options,
            bots: ['a', 'b'].map((appId) => ({ appId, secret: 'postgres-fixture' })),
            execution: { concurrency: 16, queueCapacity: 64, shutdownTimeoutMs: 5000 },
            outbound: { concurrency: 8 },
            diagnostics: { enabled: true },
            logger: { debug() {}, info() {}, warn() {}, error() {} },
            onError: (error) => {
              errors.push(error);
            },
          },
          {
            // The real PostgreSQL store is shared with the fixture's cleanup ownership.
            persistence: store,
            fetch: async (input, init) => {
              await delay(2);
              return fixture.fetcher(input, init);
            },
            transport: () => ({ start: async () => {}, stop: async () => {} }),
          },
        );
        const maxima = { databaseTotal: 0, databaseWaiting: 0, inbound: 0, outbound: 0 };
        const sample = (): void => {
          const state = app.snapshot();
          maxima.databaseTotal = Math.max(maxima.databaseTotal, state.database.total);
          maxima.databaseWaiting = Math.max(maxima.databaseWaiting, state.database.waiting);
          maxima.inbound = Math.max(maxima.inbound, state.inbound.active);
          maxima.outbound = Math.max(maxima.outbound, state.outbound.active);
        };
        let sampler: ReturnType<typeof setInterval> | undefined;
        let completed = 0;
        let duplicates = 0;
        try {
          await app.start();
          sampler = setInterval(sample, 5);
          // Cold writes and warm cached observations use different event IDs.
          for (const round of ['cold', 'warm']) {
            let next = 0;
            const started = performance.now();
            await Promise.all(
              Array.from({ length: 24 }, async () => {
                for (;;) {
                  const index = next++;
                  if (index >= 4000) return;
                  const appId = index % 2 === 0 ? 'a' : 'b';
                  const slot = Math.floor(index / 2);
                  const payload = {
                    op: 0,
                    t: 'GROUP_MESSAGE_CREATE',
                    d: {
                      id: `${round}-${index}`,
                      content: '/lookup',
                      group_openid: `${appId}-group-${slot}`,
                      author: { member_openid: String(slot) },
                    },
                  };
                  const execution = app.runtime(appId).execution;
                  const size = Buffer.byteLength(JSON.stringify(payload));
                  const admission = execution.accept(payload, size);
                  assert.equal(admission.status, 'accepted');
                  if (admission.status !== 'accepted') throw new Error('Fixture was not admitted');
                  if (index % 100 === 0) {
                    const duplicate = execution.accept(payload, size);
                    assert.equal(duplicate.status, 'duplicate');
                    if (duplicate.status === 'duplicate')
                      assert.equal(duplicate.done, admission.done);
                    duplicates++;
                  }
                  await admission.done;
                  completed++;
                }
              }),
            );
            t.diagnostic(
              JSON.stringify({
                round,
                events: 4000,
                elapsedMs: Math.round(performance.now() - started),
              }),
            );
          }
          assert.equal(completed, 8000);
          assert.equal(duplicates, 80);
          assert.equal(loads, 8000);
          assert.equal(httpCalls, loads);
          assert.equal(slowCalls, 400);
          assert.equal(fixture.botMessages.length, 8000);
          for (const message of fixture.botMessages) {
            assert.equal(message.target.scene, 'group');
            if (message.target.scene !== 'group') throw new Error('Expected group reply');
            const group = message.target.groupId;
            const slot = Number(group.split('-').at(-1));
            assert.equal(group, `${message.appId}-group-${slot}`);
            assert.equal(message.payload.content, `${message.appId}:${slot}`);
          }
          const count = await store.query<{ count: number }>(
            `SELECT count(*)::integer AS count FROM "${store.schema}".group_addresses`,
          );
          assert.equal(count.rows[0]!.count, 4000);
          assert.deepEqual(errors, []);
          assert.deepEqual(reports, []);
          assert.ok(maxima.databaseTotal <= 4);
          assert.ok(maxima.inbound <= 16);
          assert.ok(maxima.outbound <= 8);
          await app.close();
          const after = app.snapshot();
          assert.equal(after.inbound.active, 0);
          assert.equal(after.inbound.pending, 0);
          assert.equal(after.outbound.active, 0);
          assert.equal(after.outbound.pending, 0);
          assert.deepEqual(after.database, { total: 0, idle: 0, waiting: 0 });
          assert.deepEqual(errors, []);
          assert.deepEqual(reports, []);
          t.diagnostic(
            JSON.stringify({
              completed,
              duplicates,
              loads,
              slowCalls,
              maxima,
              after: after.database,
            }),
          );
        } finally {
          if (sampler) clearInterval(sampler);
          await app.close();
          await host.close();
        }
      },
      { max: 4 },
    ),
);
