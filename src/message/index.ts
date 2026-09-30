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
export function copyTarget(target: MessageTarget): MessageTarget {
  if (!isRecord(target)) bad('Invalid message target');
  if (target.scene === 'group')
    return Object.freeze({ scene: 'group', groupId: string(target.groupId, 'groupId') });
  if (target.scene === 'private')
    return Object.freeze({ scene: 'private', userId: string(target.userId, 'userId') });
  return bad('Unknown target scene');
}
export const targetKey = (target: MessageTarget): string =>
  JSON.stringify([target.scene, target.scene === 'group' ? target.groupId : target.userId]);
export const text = (content: string): TextMessage => Object.freeze({ kind: 'text', content });
export const image = (source: ImageSource, options: { caption?: string } = {}): ImageMessage =>
  Object.freeze({ kind: 'image', source, ...options });
export const markdown = (content: string, options: { keyboard?: Keyboard } = {}): MarkdownMessage =>
  Object.freeze({ kind: 'markdown', body: { content }, ...options });
export const keyboard = (rows: readonly (readonly KeyboardButton[])[]): Keyboard => ({
  kind: 'inline',
  rows,
});
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
      rows: value.rows.map((row) => {
        if (!Array.isArray(row) || row.length === 0 || row.length > 5)
          bad('A keyboard row requires 1–5 buttons');
        return {
          buttons: row.map((item: KeyboardButton) => {
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
              userIds = permission.userIds.map((id: unknown) => string(id, 'permission userId'));
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

export function snapshotMessage(input: MessageInput, maxUploadBytes = 10485760): OutgoingMessage {
  if (typeof input === 'string') return text(string(input, 'text'));
  if (!isRecord(input)) bad('Handler must return a message or undefined');
  if (input.kind === 'text') return text(string(input.content, 'text'));
  if (input.kind === 'image') {
    let source: ImageSource;
    if (typeof input.source === 'string') source = httpUrl(input.source);
    else if (input.source instanceof Uint8Array) {
      if (!input.source.length || input.source.length > maxUploadBytes)
        throw new FrameworkError('RESOURCE_LIMIT', 'Image size is outside the configured limit');
      source = new Uint8Array(input.source);
    } else if (isRecord(input.source) && input.source.kind === 'uploaded-image') {
      const uploaded = input.source;
      if (
        uploaded.expiresAt !== undefined &&
        (!Number.isFinite(uploaded.expiresAt) || typeof uploaded.expiresAt !== 'number')
      )
        bad('Invalid media expiry');
      source = Object.freeze({
        kind: 'uploaded-image',
        appId: string(uploaded.appId, 'media appId'),
        apiOrigin: string(uploaded.apiOrigin, 'media API origin'),
        target: copyTarget(uploaded.target),
        fileInfo: string(uploaded.fileInfo, 'fileInfo'),
        ...(uploaded.fileUuid === undefined
          ? {}
          : { fileUuid: string(uploaded.fileUuid, 'fileUuid') }),
        ...(uploaded.expiresAt === undefined ? {} : { expiresAt: uploaded.expiresAt }),
      }) satisfies UploadedImage;
    } else return bad('Invalid image source');
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
