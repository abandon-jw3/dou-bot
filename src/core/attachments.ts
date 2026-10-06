import type { Attachment } from '../contracts.js';

export type AttachmentSelection = 'all' | 'image' | 'video' | 'audio' | 'file';

export const attachmentLabels: Readonly<Record<AttachmentSelection, string>> = Object.freeze({
  all: '附件',
  image: '图片',
  video: '视频',
  audio: '音频',
  file: '文件',
});

function category(
  contentType: string | undefined,
): Exclude<AttachmentSelection, 'all'> | undefined {
  // Normalize only the selector input; preserve the platform's metadata and raw payload.
  const type = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  if (type === 'voice') return 'audio';
  if (type === 'file') return 'file';
  // MIME media ranges (such as image/*) are not concrete attachment content types.
  if (!type || !/^[!#$%&'+.^_`|~0-9a-z-]+\/[!#$%&'+.^_`|~0-9a-z-]+$/u.test(type)) return undefined;
  const primary = type.slice(0, type.indexOf('/'));
  return primary === 'image' || primary === 'video' || primary === 'audio' ? primary : 'file';
}

/** Non-consuming, shallow readonly snapshots; attachment objects keep their existing contract. */
export function selectAttachments(
  attachments: readonly Attachment[],
  selection: AttachmentSelection,
): readonly Attachment[] {
  return Object.freeze(
    selection === 'all'
      ? [...attachments]
      : attachments.filter((attachment) => category(attachment.contentType) === selection),
  );
}
