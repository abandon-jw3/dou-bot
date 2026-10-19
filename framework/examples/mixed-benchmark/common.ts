import assert from 'node:assert/strict';
import { createPrivateKey, sign } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import type { GroupRole, QQDispatch } from '../../src/index.js';

export const appId = 'mixed-benchmark-app';
export const secret = 'mixed-benchmark-fixture-secret';
export type Kind =
  | 'query'
  | 'admin'
  | 'images'
  | 'file'
  | 'button'
  | 'prompt'
  | 'picture'
  | 'badargs'
  | 'failure'
  | 'large'
  | 'answer'
  | 'distractor'
  | 'hold'
  | 'shutdown-prompt';
export interface Phase {
  name: string;
  durationMs: number;
  rate: number;
  faults?: boolean;
  large?: boolean;
}
export interface Profile {
  name: 'smoke' | 'standard' | 'connections';
  phases: Phase[];
  concurrency: number;
  queueCapacity: number;
  queueMaxBytes: number;
  loadTimeoutMs: number;
  requestTimeoutMs: number;
  promptTimeoutMs: number;
  baseDataMs: number;
  slowDataMs: number;
  baseApiMs: number;
  tokenSeconds: number;
  shutdownTimeoutMs: number;
  driverMaxInFlight: number;
  driverMaxSockets: number;
}
export function profile(name: string): Profile {
  assert.ok(
    name === 'smoke' || name === 'standard' || name === 'connections',
    'Profile must be smoke, standard or connections',
  );
  const config: Profile =
    name === 'smoke'
      ? {
          name,
          concurrency: 2,
          queueCapacity: 12,
          queueMaxBytes: 192 * 1024,
          loadTimeoutMs: 300,
          requestTimeoutMs: 250,
          promptTimeoutMs: 250,
          baseDataMs: 5,
          slowDataMs: 70,
          baseApiMs: 3,
          tokenSeconds: 2,
          shutdownTimeoutMs: 150,
          driverMaxInFlight: 128,
          driverMaxSockets: 128,
          phases: [
            { name: 'steady', durationMs: 2000, rate: 25 },
            { name: 'burst', durationMs: 2000, rate: 300 },
            { name: 'large', durationMs: 1500, rate: 200, large: true },
            { name: 'faults', durationMs: 2000, rate: 50, faults: true },
            { name: 'recovery', durationMs: 3000, rate: 15 },
          ],
        }
      : {
          name,
          concurrency: 32,
          queueCapacity: 2000,
          queueMaxBytes: 32 * 1024 * 1024,
          loadTimeoutMs: 1800,
          requestTimeoutMs: 1200,
          promptTimeoutMs: 1500,
          baseDataMs: 15,
          slowDataMs: 450,
          baseApiMs: 15,
          tokenSeconds: 12,
          shutdownTimeoutMs: 800,
          driverMaxInFlight: 2048,
          driverMaxSockets: 256,
          phases: [
            { name: 'warmup', durationMs: 10000, rate: 50 },
            { name: 'steady-50', durationMs: 60000, rate: 50 },
            { name: 'ramp-200', durationMs: 45000, rate: 200 },
            { name: 'ramp-500', durationMs: 45000, rate: 500 },
            { name: 'ramp-1000', durationMs: 45000, rate: 1000 },
            { name: 'burst-2500', durationMs: 20000, rate: 2500 },
            { name: 'large-payload', durationMs: 20000, rate: 500, large: true },
            { name: 'faults-150', durationMs: 45000, rate: 150, faults: true },
            { name: 'recovery-50', durationMs: 60000, rate: 50 },
          ],
        };
  if (name === 'connections')
    config.phases = [
      { name: 'warmup', durationMs: 5000, rate: 50 },
      { name: 'ramp-1000', durationMs: 10000, rate: 1000 },
      { name: 'burst-2500', durationMs: 10000, rate: 2500 },
      { name: 'large-payload', durationMs: 5000, rate: 500, large: true },
      { name: 'faults-150', durationMs: 10000, rate: 150, faults: true },
      { name: 'recovery-50', durationMs: 30000, rate: 50 },
    ];
  const override = process.env.DOU_BOT_BENCHMARK_MAX_SOCKETS;
  if (override !== undefined) {
    const sockets = Number(override);
    assert.ok(
      Number.isSafeInteger(sockets) && sockets > 0 && sockets <= config.driverMaxInFlight,
      'DOU_BOT_BENCHMARK_MAX_SOCKETS must be an integer within the driver in-flight limit',
    );
    config.driverMaxSockets = sockets;
  }
  return config;
}
export interface Meta {
  id: number;
  root: number;
  phase: number;
  kind: Kind;
  dueNs: string;
  scene: 'group' | 'private';
  groupId: string;
  userId: string;
  role: GroupRole;
  promptMode: 'received' | 'cancelled' | 'timeout' | 'shutdown';
  step?: number;
}
export const now = () => process.hrtime.bigint();
export const elapsedMs = (start: string | bigint) => Number(now() - BigInt(start)) / 1e6;
export const hash = (id: number, salt = 0) => Math.imul(id ^ salt, 2654435761) >>> 0;
export const eventId = (meta: Pick<Meta, 'phase' | 'id'>) => `mixed-${meta.phase}-${meta.id}`;
export function parseId(value: unknown): { phase: number; id: number } | undefined {
  if (typeof value !== 'string') return;
  const match = /^mixed-(\d+)-(\d+)$/u.exec(value);
  return match ? { phase: Number(match[1]), id: Number(match[2]) } : undefined;
}
export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function metadata(payload: unknown): Meta | undefined {
  if (!record(payload) || !record(payload.d) || !record(payload.d.benchmark)) return;
  const m = payload.d.benchmark;
  return Number.isSafeInteger(m.id) && Number(m.id) >= 0 && typeof m.dueNs === 'string'
    ? (m as unknown as Meta)
    : undefined;
}
export function makeMeta(
  id: number,
  phase: number,
  dueNs: bigint,
  config: Profile,
  override?: Kind,
): Meta {
  const bucket = hash(id, 17) % 100;
  const kind: Kind =
    override ??
    (config.phases[phase]?.large
      ? 'large'
      : bucket < 40
        ? 'query'
        : bucket < 50
          ? 'admin'
          : bucket < 60
            ? 'images'
            : bucket < 70
              ? 'file'
              : bucket < 80
                ? 'button'
                : bucket < 93
                  ? 'prompt'
                  : bucket < 97
                    ? 'picture'
                    : bucket < 99
                      ? 'badargs'
                      : 'failure');
  const scene = hash(id, 47) % 100 < 85 ? 'group' : 'private';
  const group = hash(id, 29) % 5 === 0 ? 0 : 1 + (hash(id, 71) % 1999);
  const mode = hash(id, 101) % 10;
  return {
    id,
    root: id,
    phase,
    kind,
    dueNs: dueNs.toString(),
    scene,
    groupId: `group-${group}`,
    userId: ['prompt', 'shutdown-prompt'].includes(kind)
      ? `prompt-user-${id}`
      : `user-${hash(id, 7) % 100}`,
    role: (['member', 'admin', 'owner'] as const)[hash(id, 13) % 3]!,
    promptMode:
      kind === 'shutdown-prompt'
        ? 'shutdown'
        : mode < 6
          ? 'received'
          : mode < 8
            ? 'cancelled'
            : 'timeout',
  };
}
export function event(meta: Meta): QQDispatch {
  const id = eventId(meta);
  if (meta.kind === 'button')
    return {
      op: 0,
      t: 'INTERACTION_CREATE',
      id,
      d: {
        id,
        chat_type: meta.scene === 'group' ? 1 : 2,
        ...(meta.scene === 'group'
          ? { group_openid: meta.groupId, group_member_openid: meta.userId }
          : { user_openid: meta.userId }),
        data: { resolved: { button_id: 'mixed:button', button_data: String(meta.id) } },
        benchmark: meta,
      },
    };
  let content: string;
  const attachments: Record<string, unknown>[] = [];
  if (meta.kind === 'file') {
    content = '';
    attachments.push({
      filename: `report-${meta.id}.docx`,
      content_type: 'file',
      url: 'https://fixture.invalid/document',
      size: 1024,
    });
  } else if (meta.kind === 'images') {
    content = `/images ${meta.id}`;
    for (let index = 0; index < 1 + (meta.id % 4); index++)
      attachments.push({
        filename: `image-${index}.jpg`,
        content_type: 'image/jpeg',
        url: `https://fixture.invalid/image-${index}`,
        size: 65536,
      });
  } else if (meta.kind === 'query' || meta.kind === 'large')
    content = `/query ${meta.id} 双梦 --page 2 ${meta.kind === 'large' ? 'x'.repeat(65536) : 'note'}`;
  else if (meta.kind === 'badargs') content = `/query ${meta.id} --page invalid`;
  else if (meta.kind === 'answer' || meta.kind === 'distractor')
    content = meta.promptMode === 'cancelled' ? '取消' : `/answer-${meta.root}-${meta.step ?? 1}`;
  else content = `/${meta.kind === 'shutdown-prompt' ? 'prompt' : meta.kind} ${meta.id}`;
  return {
    op: 0,
    t: meta.scene === 'group' ? 'GROUP_MESSAGE_CREATE' : 'C2C_MESSAGE_CREATE',
    id,
    d: {
      id,
      content,
      attachments,
      ...(meta.scene === 'group'
        ? {
            group_openid: meta.groupId,
            author: { member_openid: meta.userId, member_role: meta.role },
          }
        : { author: { user_openid: meta.userId } }),
      benchmark: meta,
    },
  };
}
const seed = Buffer.alloc(32);
const secretBytes = Buffer.from(secret);
for (let i = 0; i < seed.length; i++) seed[i] = secretBytes[i % secretBytes.length]!;
const key = createPrivateKey({
  key: Buffer.concat([Buffer.from('302e020100300506032b657004220420', 'hex'), seed]),
  type: 'pkcs8',
  format: 'der',
});
export function signedHeaders(body: Buffer): Record<string, string> {
  const stamp = String(Math.floor(Date.now() / 1000));
  return {
    'content-type': 'application/json',
    'content-length': String(body.length),
    'x-bot-appid': appId,
    'x-signature-timestamp': stamp,
    'x-signature-ed25519': sign(null, Buffer.concat([Buffer.from(stamp), body]), key).toString(
      'hex',
    ),
  };
}
export class Histogram {
  readonly bins = new Uint32Array(60002);
  count = 0;
  total = 0;
  max = 0;
  add(value: number): void {
    assert.ok(Number.isFinite(value) && value >= 0, 'Clock or latency is invalid');
    this.bins[Math.min(60001, Math.ceil(value))]!++;
    this.count++;
    this.total += value;
    this.max = Math.max(this.max, value);
  }
  snapshot() {
    const quantile = (fraction: number) => {
      if (!this.count) return 0;
      let sum = 0;
      for (let i = 0; i < this.bins.length; i++) {
        sum += this.bins[i]!;
        if (sum >= Math.ceil(this.count * fraction)) return i === 60001 ? null : i;
      }
      throw new Error('Histogram count mismatch');
    };
    return {
      count: this.count,
      meanMs: this.count ? this.total / this.count : 0,
      maxMs: this.max,
      p50UpperMs: quantile(0.5),
      p95UpperMs: quantile(0.95),
      p99UpperMs: quantile(0.99),
    };
  }
}
export function send(message: Record<string, unknown>): void {
  if (process.connected) process.send?.(message);
}

/** Persist large reports before sending a small IPC completion notice. */
export async function finishReport(
  type: string,
  report: unknown,
  destination: string,
): Promise<void> {
  await writeFile(destination, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  if (process.connected)
    await new Promise<void>((resolve, reject) => {
      process.send?.({ type, reportPath: destination }, (error) =>
        error ? reject(error) : resolve(),
      );
    });
}
