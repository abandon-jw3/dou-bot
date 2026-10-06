import type {
  Attachment,
  AttachmentKind,
  AttachmentSelectionOptions,
  AttachmentSelectionResult,
} from '../contracts.js';
import { FrameworkError } from './errors.js';
import { isRecord } from './utils.js';

export const attachmentLabels: Readonly<Record<AttachmentKind, string>> = Object.freeze({
  all: '附件',
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
});

function category(contentType: string | undefined): Exclude<AttachmentKind, 'all'> | undefined {
  // Normalize only the selector input; preserve the platform's metadata and raw payload.
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (type === 'voice') return 'audio';
  if (type === 'file') return 'file';
  // MIME media ranges (such as image/*) are not concrete attachment content types.
  if (!type || !/^[!#$%&'+.^_`|~0-9a-z-]+\/[!#$%&'+.^_`|~0-9a-z-]+$/u.test(type)) return undefined;
  const primary = type.slice(0, type.indexOf('/'));
  return primary === 'image' || primary === 'video' || primary === 'audio' ? primary : 'file';
}

interface AttachmentCounts {
  minCount: number;
  maxCount?: number;
}

/** Declaration errors and business call errors keep their respective framework error codes. */
export function attachmentCounts(
  minCount: unknown,
  maxCount: unknown,
  code: 'CONFIG' | 'HANDLER_CONTRACT',
): AttachmentCounts {
  for (const [key, value] of Object.entries({ minCount, maxCount }))
    if (
      value !== undefined &&
      (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    )
      throw new FrameworkError(code, `Attachment ${key} must be a non-negative safe integer`);
  const minimum = minCount === undefined ? 0 : (minCount as number);
  const maximum = maxCount as number | undefined;
  if (maximum !== undefined && maximum < minimum)
    throw new FrameworkError(code, 'Attachment maxCount cannot be less than minCount');
  return { minCount: minimum, ...(maximum === undefined ? {} : { maxCount: maximum }) };
}

/** Shared classification without cardinality validation. */
export function filterAttachmentValues(
  attachments: readonly Attachment[],
  kind: AttachmentKind,
): Attachment[] {
  return kind === 'all'
    ? [...attachments]
    : attachments.filter((attachment) => category(attachment.contentType) === kind);
}

/** Shared selection and cardinality rules; only the caller decides how to report invalid input. */
export function selectAttachmentValues(
  attachments: readonly Attachment[],
  kind: AttachmentKind,
  counts: AttachmentCounts,
): AttachmentSelectionResult {
  const selected = filterAttachmentValues(attachments, kind);
  if (selected.length < counts.minCount)
    return Object.freeze({
      status: 'invalid',
      reason: 'too-few',
      count: selected.length,
      limit: counts.minCount,
    });
  if (counts.maxCount !== undefined && selected.length > counts.maxCount)
    return Object.freeze({
      status: 'invalid',
      reason: 'too-many',
      count: selected.length,
      limit: counts.maxCount,
    });
  return Object.freeze({ status: 'valid', attachments: Object.freeze(selected) });
}

/** Synchronous selection of normalized attachments, without waiting, sending or reporting errors. */
export function selectAttachments(
  attachments: readonly Attachment[],
  options: AttachmentSelectionOptions = {},
): AttachmentSelectionResult {
  if (
    !isRecord(options) ||
    Object.keys(options).some((key) => !['kind', 'minCount', 'maxCount'].includes(key))
  )
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid attachment selection options');
  const kind = options.kind === undefined ? 'all' : options.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(attachmentLabels, kind))
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid attachment kind');
  const counts = attachmentCounts(options.minCount, options.maxCount, 'HANDLER_CONTRACT');
  if (
    !Array.isArray(attachments) ||
    !Array.from(attachments as unknown[]).every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.url === 'string' &&
        isRecord(entry.raw) &&
        (entry.contentType === undefined || typeof entry.contentType === 'string'),
    )
  )
    throw new FrameworkError(
      'HANDLER_CONTRACT',
      'selectAttachments requires normalized Attachment values',
    );
  return selectAttachmentValues(attachments, kind as AttachmentKind, counts);
}
