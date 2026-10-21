// #region health
import type { Application } from 'dou-bot';

export function readHealth(app: Application) {
  const snapshot = app.snapshot();
  return {
    status: snapshot.status,
    inbound: snapshot.inbound,
    outbound: snapshot.outbound,
    database: snapshot.database,
    bots: snapshot.bots.map((bot) => ({
      appId: bot.appId,
      status: bot.status,
      pending: bot.queue.pending,
      replyRecords: bot.capacity.replyScopes.size,
      replyLimit: bot.capacity.replyScopes.limit,
      rejections: bot.rejections,
    })),
  };
}

// #endregion health

// #region stages
export function readSlowStages(app: Application) {
  return app.diagnostics.snapshot().metrics.map((metric) => ({
    stage: metric.stage,
    appId: metric.appId,
    count: metric.count,
    p95UpperMs: metric.p95UpperMs,
    active: metric.active,
    oldestActiveMs: metric.oldestActiveMs,
  }));
}
// #endregion stages
