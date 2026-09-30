import type { Attachment, GroupRole, MessageTarget, QQDispatch } from '../contracts.js';
import { isGroupRole } from '../core/access.js';
import { isRecord, own } from '../core/utils.js';
import { systemClock } from '../core/clock.js';

export type NormalizedEvent =
  | {
      kind: 'message';
      raw: QQDispatch;
      receivedAt: number;
      target: MessageTarget;
      userId: string;
      memberRole?: GroupRole;
      messageId: string;
      content: string;
      attachments: readonly Attachment[];
      timestamp?: number;
      sourceIndex: string;
    }
  | {
      kind: 'button';
      raw: QQDispatch;
      receivedAt: number;
      target: MessageTarget;
      userId: string;
      interactionId: string;
      buttonId: string;
      data: string;
    }
  | { kind: 'event'; raw: QQDispatch; receivedAt: number };
export type NormalizeResult =
  | { status: 'ok'; event: NormalizedEvent; conflictingFields?: readonly string[] }
  | { status: 'invalid'; reason: string };
const id = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

export function isDispatch(value: unknown): value is QQDispatch {
  return (
    isRecord(value) &&
    own(value, 'op') &&
    value.op === 0 &&
    own(value, 't') &&
    typeof value.t === 'string' &&
    !!value.t &&
    own(value, 'd')
  );
}

function timestamp(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.includes('m=')
    ? value
        .slice(0, value.indexOf('m='))
        .trim()
        .replace(/\+(\d{4}) CST/, 'GMT+$1')
    : value;
  const result = Date.parse(normalized);
  return Number.isFinite(result) ? result : undefined;
}

function groupContent(content: string, mentions: unknown): string {
  if (!Array.isArray(mentions)) return content;
  const selfIds = new Set<string>();
  for (const mention of mentions as unknown[]) {
    if (!isRecord(mention) || mention.is_you !== true) continue;
    for (const value of [mention.id, mention.member_openid]) {
      const mentionId = id(value);
      if (mentionId) selfIds.add(mentionId);
    }
  }
  // Match only leading mentions proven to address this bot in this event.
  // Other users, other bots, and mentions inside command arguments stay intact.
  let offset = 0;
  while (selfIds.size > 0) {
    const match = /^\s*<@!?([A-Za-z0-9_-]+)>\s*/u.exec(content.slice(offset));
    if (!match?.[1] || !selfIds.has(match[1])) break;
    offset += match[0].length;
  }
  return content.slice(offset);
}

export function normalize(raw: QQDispatch, receivedAt = systemClock.wallTime()): NormalizeResult {
  const data = raw.d;
  const invalid = (reason: string): NormalizeResult => ({ status: 'invalid', reason });
  if (['GROUP_AT_MESSAGE_CREATE', 'GROUP_MESSAGE_CREATE', 'C2C_MESSAGE_CREATE'].includes(raw.t)) {
    if (!isRecord(data) || !isRecord(data.author)) return invalid('Message author is missing');
    const scene = raw.t === 'C2C_MESSAGE_CREATE' ? 'private' : 'group';
    const userId =
      id(data.author.id) ??
      id(scene === 'group' ? data.author.member_openid : data.author.user_openid);
    const messageId = id(data.id);
    const groupId = id(data.group_id) ?? id(data.group_openid);
    const conflictingFields: string[] = [];
    const aliasUser = scene === 'group' ? data.author.member_openid : data.author.user_openid;
    if (id(data.author.id) && id(aliasUser) && data.author.id !== aliasUser)
      conflictingFields.push(
        scene === 'group' ? 'author.id/member_openid' : 'author.id/user_openid',
      );
    if (
      scene === 'group' &&
      id(data.group_id) &&
      id(data.group_openid) &&
      data.group_id !== data.group_openid
    )
      conflictingFields.push('group_id/group_openid');
    if (!messageId || !userId || (scene === 'group' && !groupId))
      return invalid('Message identity is missing');
    if (data.content !== undefined && typeof data.content !== 'string')
      return invalid('Invalid message content');
    const target: MessageTarget =
      scene === 'private' ? { scene, userId } : { scene, groupId: groupId ?? '' };
    const attachments: Attachment[] = [];
    if (data.attachments !== undefined && !Array.isArray(data.attachments))
      return invalid('Invalid attachments');
    for (const entry of (data.attachments ?? []) as unknown[]) {
      if (!isRecord(entry) || typeof entry.url !== 'string') return invalid('Invalid attachment');
      attachments.push({
        url: entry.url,
        raw: entry,
        ...(typeof entry.filename === 'string' ? { filename: entry.filename } : {}),
        ...(typeof entry.content_type === 'string' ? { contentType: entry.content_type } : {}),
        ...(typeof entry.width === 'number' ? { width: entry.width } : {}),
        ...(typeof entry.height === 'number' ? { height: entry.height } : {}),
        ...(typeof entry.size === 'number' ? { size: entry.size } : {}),
      });
    }
    const ext: unknown = isRecord(data.message_scene) ? data.message_scene.ext : undefined;
    const sourceIndex = Array.isArray(ext)
      ? (ext as unknown[])
          .find((item): item is string => typeof item === 'string' && item.startsWith('msg_idx='))
          ?.slice(8)
      : undefined;
    const time = timestamp(data.timestamp);
    const memberRole =
      scene === 'group' && isGroupRole(data.author.member_role)
        ? data.author.member_role
        : undefined;
    return {
      status: 'ok',
      ...(conflictingFields.length ? { conflictingFields } : {}),
      event: {
        kind: 'message',
        raw,
        receivedAt,
        target,
        userId,
        ...(memberRole === undefined ? {} : { memberRole }),
        messageId,
        content:
          typeof data.content !== 'string'
            ? ''
            : scene === 'group'
              ? groupContent(data.content, data.mentions)
              : data.content,
        attachments,
        ...(time === undefined ? {} : { timestamp: time }),
        sourceIndex: sourceIndex ?? (typeof data.msg_seq === 'number' ? String(data.msg_seq) : ''),
      },
    };
  }
  if (raw.t === 'INTERACTION_CREATE') {
    if (!isRecord(data) || !isRecord(data.data) || !isRecord(data.data.resolved))
      return invalid('Invalid interaction');
    if (data.chat_type !== 1 && data.chat_type !== 2)
      return { status: 'ok', event: { kind: 'event', raw, receivedAt } };
    const scene = data.chat_type === 1 ? 'group' : 'private';
    const resolved = data.data.resolved;
    const userId =
      id(scene === 'group' ? data.group_member_openid : data.user_openid) ?? id(resolved.user_id);
    const interactionId = id(data.id);
    const buttonId = id(resolved.button_id);
    const groupId = id(data.group_openid);
    if (
      !userId ||
      !interactionId ||
      !buttonId ||
      (scene === 'group' && !groupId) ||
      (resolved.button_data !== undefined && typeof resolved.button_data !== 'string')
    )
      return invalid('Interaction identity is missing');
    return {
      status: 'ok',
      event: {
        kind: 'button',
        raw,
        receivedAt,
        userId,
        interactionId,
        buttonId,
        target: scene === 'group' ? { scene, groupId: groupId ?? '' } : { scene, userId },
        data: typeof resolved.button_data === 'string' ? resolved.button_data : '',
      },
    };
  }
  return { status: 'ok', event: { kind: 'event', raw, receivedAt } };
}
