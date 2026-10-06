import type { Attachment, OnAttachmentOptions } from '../contracts.js';
import { attachmentLabels, filterAttachmentValues } from './attachments.js';
import { FrameworkError } from './errors.js';
import { isRecord } from './utils.js';

/** Compile declaration snapshots without inspecting URLs or downloading content. */
export class AttachmentRoute {
  private readonly filename: string | RegExp | undefined;
  private readonly extension: string | undefined;
  constructor(private readonly options: Readonly<OnAttachmentOptions>) {
    if (
      !isRecord(options) ||
      Object.keys(options).some(
        (key) => !['filename', 'extension', 'kind', 'invalidInput'].includes(key),
      ) ||
      (options.filename !== undefined &&
        !(typeof options.filename === 'string' && options.filename.length > 0) &&
        !(options.filename instanceof RegExp)) ||
      (options.extension !== undefined &&
        (typeof options.extension !== 'string' || !/^\.?[^.\s/\\*?]+$/u.test(options.extension))) ||
      (options.kind !== undefined &&
        (typeof options.kind !== 'string' || !Object.hasOwn(attachmentLabels, options.kind))) ||
      (options.invalidInput !== undefined &&
        options.invalidInput !== 'report' &&
        options.invalidInput !== 'reply')
    )
      throw new FrameworkError('CONFIG', 'Invalid attachment route options');
    this.filename =
      options.filename instanceof RegExp
        ? new RegExp(options.filename.source, options.filename.flags)
        : options.filename;
    this.extension = options.extension?.replace(/^\./u, '').toLowerCase();
  }

  select(attachments: readonly Attachment[]): readonly Attachment[] {
    const selected = filterAttachmentValues(attachments, this.options.kind ?? 'all');
    return Object.freeze(
      selected.filter((attachment) => {
        const name = attachment.filename;
        if (
          this.extension !== undefined &&
          (name === undefined || !name.toLowerCase().endsWith(`.${this.extension}`))
        )
          return false;
        if (this.filename === undefined) return true;
        if (name === undefined) return false;
        if (typeof this.filename === 'string') return name === this.filename;
        this.filename.lastIndex = 0;
        return this.filename.test(name);
      }),
    );
  }
}
