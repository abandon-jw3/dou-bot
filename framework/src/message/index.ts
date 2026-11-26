import type {
  ButtonOptions,
  CallbackButtonOptions,
  ImageMessage,
  ImageSource,
  Keyboard,
  KeyboardButton,
  MarkdownMessage,
  MessageInput,
  MessageTarget,
  OutgoingMessage,
  QQKeyboardPayload,
  TextMessage,
  UploadedImage,
} from '../contracts.js';
import { FrameworkError } from '../core/errors.js';
import { isRecord } from '../core/utils.js';

function bad(message: string): never {
  throw new FrameworkError('HANDLER_CONTRACT', message);
}
function string(value: unknown, label: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()))
    bad(`${label} must be a string${allowEmpty ? '' : ' with content'}`);
  return value;
}
function httpUrl(value: unknown): string {
  const input = string(value, 'URL');
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    return bad('Invalid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    bad('URL must be HTTP(S) without credentials');
  return input;
}
export type PreparedMessage =
  | { readonly kind: 'text'; readonly content: string; readonly bytes: number }
  | {
      readonly kind: 'image';
      readonly source: ImageSource;
      readonly caption?: string;
      readonly bytes: number;
    }
  | {
      readonly kind: 'markdown';
      readonly content: string;
      readonly keyboard?: QQKeyboardPayload;
      readonly bytes: number;
    };

export function copyTarget(target: MessageTarget): MessageTarget {
  if (!isRecord(target)) bad('Invalid message target');
  if (target.scene === 'group')
    return { scene: 'group', groupId: string(target.groupId, 'groupId') };
  if (target.scene === 'private')
    return { scene: 'private', userId: string(target.userId, 'userId') };
  return bad('Unknown target scene');
}
export const targetKey = (target: MessageTarget): string =>
  `${target.scene}\0${target.scene === 'group' ? target.groupId : target.userId}`;
export const text = (content: string): TextMessage => ({ kind: 'text', content });
export const image = (source: ImageSource, options: { caption?: string } = {}): ImageMessage => ({
  kind: 'image',
  source,
  ...options,
});
export const markdown = (
  content: string,
  options: { keyboard?: Keyboard } = {},
): MarkdownMessage => ({ kind: 'markdown', body: { content }, ...options });
/** Lay out buttons in order. The last width repeats; the default is one button per row. */
export function keyboard(
  buttons: readonly KeyboardButton[],
  perRow?: number | readonly number[],
): Keyboard;
export function keyboard(rows: Keyboard['rows']): Keyboard;
export function keyboard(
  buttons: readonly KeyboardButton[] | Keyboard['rows'],
  perRow?: number | readonly number[],
): Keyboard {
  if (!Array.isArray(buttons)) bad('Keyboard requires an array of buttons or rows');
  if (Array.isArray(buttons[0]) || (!buttons.length && perRow === undefined)) {
    if (perRow !== undefined) bad('Specify row widths only for a flat button list');
    return { kind: 'inline', rows: buttons as Keyboard['rows'] };
  }
  if (perRow !== undefined && typeof perRow !== 'number' && !Array.isArray(perRow))
    bad('Keyboard row widths must be a number or an array');
  const widths: readonly number[] = typeof perRow === 'number' ? [perRow] : (perRow ?? [1]);
  if (!widths.length) bad('Keyboard requires at least one row width');
  for (const width of widths) {
    if (!Number.isInteger(width) || width < 1 || width > 5)
      bad('A keyboard row width must be an integer from 1 to 5');
  }
  const flat = buttons as readonly KeyboardButton[];
  const rows: KeyboardButton[][] = [];
  for (let offset = 0; offset < flat.length;) {
    const width = widths[Math.min(rows.length, widths.length - 1)]!;
    rows.push(flat.slice(offset, offset + width));
    offset += width;
  }
  return { kind: 'inline', rows };
}
export const button = {
  link: (label: string, url: string, options?: ButtonOptions): KeyboardButton => ({
    type: 'link',
    label,
    url,
    ...(options === undefined ? {} : { options }),
  }),
  command: (
    label: string,
    command: string,
    options?: ButtonOptions & { enter?: boolean },
  ): KeyboardButton => ({
    type: 'command',
    label,
    command,
    enter: options?.enter ?? false,
    ...(options === undefined ? {} : { options }),
  }),
  callback: (
    id: string,
    label: string,
    data = '',
    options?: CallbackButtonOptions,
  ): KeyboardButton => ({
    type: 'callback',
    id,
    label,
    data,
    ...(options === undefined ? {} : { options }),
  }),
};

export function encodeKeyboard(value: Keyboard): QQKeyboardPayload {
  if (!isRecord(value)) bad('Invalid keyboard');
  if (value.id !== undefined) bad('Template keyboards are not supported');
  if (value.kind !== 'inline' || !Array.isArray(value.rows) || value.rows.length === 0)
    bad('Keyboard requires rows');
  const seen = new Set<string>();
  return {
    content: {
      rows: Array.from(value.rows, (row) => {
        if (!Array.isArray(row) || row.length === 0 || row.length > 5)
          bad('A keyboard row requires 1–5 buttons');
        return {
          buttons: Array.from(row, (item: KeyboardButton) => {
            if (!isRecord(item)) bad('Invalid button');
            const label = string(item.label, 'button label');
            const options = item.options ?? {};
            if (!isRecord(options)) bad('Invalid button options');
            const id =
              item.type === 'callback'
                ? string(item.id, 'callback id')
                : options.id === undefined
                  ? undefined
                  : string(options.id, 'button id');
            if (item.type === 'callback' && 'id' in options)
              bad('Callback options cannot override its id');
            if (id !== undefined) {
              if (seen.has(id)) bad(`Duplicate keyboard button id ${id}`);
              seen.add(id);
            }
            if (
              options.style !== undefined &&
              options.style !== 'primary' &&
              options.style !== 'secondary'
            )
              bad('Invalid button style');
            const permission = options.permission ?? { type: 'everyone' };
            if (
              !isRecord(permission) ||
              (permission.type !== 'everyone' &&
                permission.type !== 'users' &&
                permission.type !== 'managers')
            )
              bad('Invalid button permission');
            let userIds: string[] | undefined;
            if (permission.type === 'users') {
              if (!Array.isArray(permission.userIds) || !permission.userIds.length)
                bad('Button permission requires user ids');
              userIds = Array.from(permission.userIds, (id: unknown) =>
                string(id, 'permission userId'),
              );
            }
            let type: number;
            let data: string;
            if (item.type === 'link') {
              type = 0;
              data = httpUrl(item.url);
            } else if (item.type === 'callback') {
              type = 1;
              data = string(item.data, 'callback data', true);
            } else if (item.type === 'command') {
              type = 2;
              data = string(item.command, 'button command');
              if (typeof item.enter !== 'boolean') bad('Button enter must be boolean');
            } else return bad('Invalid button type');
            return {
              ...(id === undefined ? {} : { id }),
              render_data: {
                label,
                visited_label:
                  options.visitedLabel === undefined
                    ? label
                    : string(options.visitedLabel, 'visitedLabel', true),
                style: options.style === 'primary' ? 1 : 0,
              },
              action: {
                type,
                data,
                ...(item.type === 'command' ? { enter: item.enter } : {}),
                permission: {
                  type: permission.type === 'everyone' ? 2 : permission.type === 'managers' ? 1 : 0,
                  ...(userIds ? { specify_user_ids: userIds } : {}),
                },
              },
            };
          }),
        };
      }),
    },
  };
}

/** Called after keyboard validation, before any QQ request. */
export function assertKeyboardScene(
  keyboard: QQKeyboardPayload | undefined,
  scene: 'group' | 'private',
): void {
  if (
    scene === 'private' &&
    keyboard?.content.rows.some((row) =>
      row.buttons.some((button) => button.action.permission.type === 1),
    )
  )
    bad('Manager-only buttons require a group target');
}

function snapshotImageSource(
  sourceInput: unknown,
  maxUploadBytes: number,
): { source: ImageSource; bytes: number } {
  if (typeof sourceInput === 'string') {
    const url = httpUrl(sourceInput);
    return { source: url, bytes: Buffer.byteLength(url) };
  }
  if (sourceInput instanceof Uint8Array) {
    if (!sourceInput.length || sourceInput.length > maxUploadBytes)
      throw new FrameworkError('RESOURCE_LIMIT', 'Image size is outside the configured limit');
    const copy = new Uint8Array(sourceInput);
    return { source: copy, bytes: copy.byteLength };
  }
  if (isRecord(sourceInput) && sourceInput.kind === 'uploaded-image') {
    if (
      sourceInput.expiresAt !== undefined &&
      (!Number.isFinite(sourceInput.expiresAt) || typeof sourceInput.expiresAt !== 'number')
    )
      bad('Invalid media expiry');
    const fileInfo = string(sourceInput.fileInfo, 'fileInfo');
    const source: UploadedImage = {
      kind: 'uploaded-image',
      appId: string(sourceInput.appId, 'media appId'),
      apiOrigin: string(sourceInput.apiOrigin, 'media API origin'),
      target: copyTarget(sourceInput.target as MessageTarget),
      fileInfo,
      ...(sourceInput.fileUuid === undefined
        ? {}
        : { fileUuid: string(sourceInput.fileUuid, 'fileUuid') }),
      ...(sourceInput.expiresAt === undefined ? {} : { expiresAt: sourceInput.expiresAt }),
    };
    return { source, bytes: Buffer.byteLength(fileInfo) + 128 };
  }
  return bad('Invalid image source');
}

/** Validate, snapshot and encode once at the boundary; also computes queue byte budget without extra serialization. */
export function prepareMessage(input: MessageInput, maxUploadBytes = 10485760): PreparedMessage {
  if (typeof input === 'string') {
    const content = string(input, 'text');
    return { kind: 'text', content, bytes: Buffer.byteLength(content) + 128 };
  }
  if (!isRecord(input)) bad('Handler must return a message or undefined');
  if (input.kind === 'text') {
    const content = string(input.content, 'text');
    return { kind: 'text', content, bytes: Buffer.byteLength(content) + 128 };
  }
  if (input.kind === 'image') {
    const { source, bytes } = snapshotImageSource(input.source, maxUploadBytes);
    const caption =
      input.caption === undefined ? undefined : string(input.caption, 'caption', true);
    return {
      kind: 'image',
      source,
      ...(caption === undefined ? {} : { caption }),
      bytes: bytes + (caption === undefined ? 0 : Buffer.byteLength(caption)) + 128,
    };
  }
  if (input.kind === 'markdown') {
    if (!isRecord(input.body)) bad('Invalid Markdown body');
    const body = input.body;
    if ('templateId' in body || 'params' in body) bad('Template Markdown is not supported');
    const content = string(body.content, 'Markdown content');
    const encoded = input.keyboard === undefined ? undefined : encodeKeyboard(input.keyboard);
    return {
      kind: 'markdown',
      content,
      ...(encoded === undefined ? {} : { keyboard: encoded }),
      bytes:
        Buffer.byteLength(content) +
        (encoded === undefined ? 0 : Buffer.byteLength(JSON.stringify(encoded))) +
        128,
    };
  }
  return bad('Unknown message kind');
}

export function snapshotMessage(input: MessageInput, maxUploadBytes = 10485760): OutgoingMessage {
  if (typeof input === 'string') return text(string(input, 'text'));
  if (!isRecord(input)) bad('Handler must return a message or undefined');
  if (input.kind === 'text') return text(string(input.content, 'text'));
  if (input.kind === 'image') {
    const { source } = snapshotImageSource(input.source, maxUploadBytes);
    return image(
      source,
      input.caption === undefined ? {} : { caption: string(input.caption, 'caption', true) },
    );
  }
  if (input.kind === 'markdown') {
    if (!isRecord(input.body)) bad('Invalid Markdown body');
    const body = input.body;
    if ('templateId' in body || 'params' in body) bad('Template Markdown is not supported');
    let result = markdown(string(body.content, 'Markdown content'));
    if (input.keyboard !== undefined) {
      encodeKeyboard(input.keyboard);
      result = { ...result, keyboard: structuredClone(input.keyboard) };
    }
    return result;
  }
  return bad('Unknown message kind');
}
