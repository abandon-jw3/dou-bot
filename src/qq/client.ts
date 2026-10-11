import { QQClient, QQApi } from '../contracts.js';
import type {
  BotUser,
  MessageInput,
  MessageTarget,
  QQMessagePayload,
  QQReplyFields,
  QQUploadImagePayload,
  RequestOptions,
  SendOptions,
  SendResult,
  UploadedImage,
} from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import { FrameworkError } from '../core/errors.js';
import { isRecord } from '../core/utils.js';
import {
  assertKeyboardScene,
  copyTarget,
  encodeKeyboard,
  snapshotMessage,
  targetKey,
} from '../message/index.js';
import { systemClock } from '../core/clock.js';
import type { Clock } from '../core/clock.js';

export class DefaultQQClient extends QQClient {
  constructor(
    override readonly api: QQApi,
    private readonly options: ResolvedOptions,
    private readonly clock: Clock = systemClock,
  ) {
    super();
  }
  override getSelf(options?: RequestOptions): Promise<BotUser> {
    return this.api.getSelf(options);
  }
  override async sendMessage(
    targetInput: MessageTarget,
    input: MessageInput,
    options: SendOptions = {},
  ): Promise<SendResult> {
    if (!isRecord(options))
      throw new FrameworkError('HANDLER_CONTRACT', 'Send options must be an object');
    // Keep one cancellation source across upload and send, even if the caller reuses its object.
    options = { ...options };
    const target = copyTarget(targetInput);
    const message = snapshotMessage(input, this.options.api.maxUploadBytes);
    const reply: QQReplyFields = options.reply
      ? { msg_id: options.reply.messageId, msg_seq: options.reply.sequence }
      : {};
    let payload: QQMessagePayload;
    if (message.kind === 'text') payload = { ...reply, msg_type: 0, content: message.content };
    else if (message.kind === 'markdown')
      payload = {
        ...reply,
        msg_type: 2,
        markdown: { content: message.body.content },
        ...(message.keyboard === undefined ? {} : { keyboard: encodeKeyboard(message.keyboard) }),
      };
    else {
      const source = message.source;
      const uploaded =
        typeof source === 'string' || source instanceof Uint8Array
          ? await this.uploadPreparedImage(target, source, options)
          : source;
      if (
        uploaded.appId !== this.options.appId ||
        uploaded.apiOrigin !== this.options.api.baseUrl ||
        targetKey(uploaded.target) !== targetKey(target)
      )
        throw new FrameworkError(
          'HANDLER_CONTRACT',
          'Uploaded image belongs to a different bot, origin or target',
        );
      if (uploaded.expiresAt !== undefined && uploaded.expiresAt <= this.clock.wallTime())
        throw new FrameworkError('HANDLER_CONTRACT', 'Uploaded image has expired');
      payload = {
        ...reply,
        msg_type: 7,
        content: message.caption || ' ',
        media: { file_info: uploaded.fileInfo },
      };
    }
    assertKeyboardScene(payload.keyboard, target.scene);
    return target.scene === 'group'
      ? this.api.sendGroupMessage(target.groupId, payload, options)
      : this.api.sendPrivateMessage(target.userId, payload, options);
  }
  override async uploadImage(
    targetInput: MessageTarget,
    sourceInput: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage> {
    const target = copyTarget(targetInput);
    const snapshot = snapshotMessage(
      { kind: 'image', source: sourceInput },
      this.options.api.maxUploadBytes,
    );
    if (
      snapshot.kind !== 'image' ||
      (typeof snapshot.source !== 'string' && !(snapshot.source instanceof Uint8Array))
    )
      throw new FrameworkError('HANDLER_CONTRACT', 'Expected image bytes or URL');
    return this.uploadPreparedImage(target, snapshot.source, options);
  }
  /** Inputs here already belong to the SDK snapshot; do not copy image bytes a second time. */
  private async uploadPreparedImage(
    target: MessageTarget,
    source: string | Uint8Array,
    options?: RequestOptions,
  ): Promise<UploadedImage> {
    const payload: QQUploadImagePayload =
      typeof source === 'string'
        ? { file_type: 1, srv_send_msg: false, url: source }
        : {
            file_type: 1,
            srv_send_msg: false,
            file_data: Buffer.from(source.buffer, source.byteOffset, source.byteLength).toString(
              'base64',
            ),
          };
    const started = this.clock.wallTime();
    const file =
      target.scene === 'group'
        ? await this.api.uploadGroupImage(target.groupId, payload, options)
        : await this.api.uploadPrivateImage(target.userId, payload, options);
    return Object.freeze({
      kind: 'uploaded-image',
      appId: this.options.appId,
      apiOrigin: this.options.api.baseUrl,
      target,
      fileInfo: file.file_info,
      ...(file.file_uuid === undefined ? {} : { fileUuid: file.file_uuid }),
      ...(file.ttl === undefined ? {} : { expiresAt: started + file.ttl * 1000 }),
    });
  }
  override deleteMessage(
    targetInput: MessageTarget,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> {
    const target = copyTarget(targetInput);
    return target.scene === 'group'
      ? this.api.deleteGroupMessage(target.groupId, messageId, options)
      : this.api.deletePrivateMessage(target.userId, messageId, options);
  }
}
