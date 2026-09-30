import { QQApi } from '../contracts.js';
import type {
  ApiRequestOptions,
  ApiResponse,
  BotUser,
  HttpMethod,
  QQFileResult,
  QQMessagePayload,
  QQUploadImagePayload,
  RequestOptions,
  SendResult,
} from '../contracts.js';
import type { ResolvedOptions } from '../core/config.js';
import { FrameworkError, QQApiError } from '../core/errors.js';
import { bounded, hasControlCharacters, isRecord } from '../core/utils.js';
import { systemClock } from '../core/clock.js';
import type { Clock } from '../core/clock.js';
import type { TokenManager } from './token.js';
import type { HttpRuntime } from './http.js';
import { lifetimeSeconds } from './lifetime.js';
import { assertKeyboardScene } from '../message/index.js';

function segment(value: string): string {
  if (
    typeof value !== 'string' ||
    !value ||
    value === '.' ||
    value === '..' ||
    hasControlCharacters(value)
  )
    throw new FrameworkError('CONFIG', 'Invalid QQ path identifier');
  return encodeURIComponent(value);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
function safeNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function validateKeyboard(payload: unknown): void {
  const bad = () => {
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid QQ keyboard payload');
  };
  if (!isRecord(payload)) return bad();
  if (payload.id !== undefined) {
    return bad();
  }
  if (
    !isRecord(payload.content) ||
    !Array.isArray(payload.content.rows) ||
    !payload.content.rows.length
  )
    return bad();
  const ids = new Set<string>();
  for (const row of payload.content.rows as unknown[]) {
    if (
      !isRecord(row) ||
      !Array.isArray(row.buttons) ||
      !row.buttons.length ||
      row.buttons.length > 5
    )
      return bad();
    for (const button of row.buttons as unknown[]) {
      if (!isRecord(button) || !isRecord(button.render_data) || !isRecord(button.action))
        return bad();
      if (button.id !== undefined) {
        if (!hasText(button.id) || ids.has(button.id)) return bad();
        ids.add(button.id);
      }
      const render = button.render_data;
      const action = button.action;
      if (
        !hasText(render.label) ||
        (render.visited_label !== undefined && typeof render.visited_label !== 'string') ||
        (render.style !== undefined && !safeNumber(render.style)) ||
        !safeNumber(action.type) ||
        typeof action.data !== 'string' ||
        (action.type === 1 && !hasText(button.id)) ||
        (action.enter !== undefined && typeof action.enter !== 'boolean') ||
        !isRecord(action.permission) ||
        !safeNumber(action.permission.type)
      )
        return bad();
      const users: unknown = action.permission.specify_user_ids;
      if (
        (users !== undefined && (!Array.isArray(users) || !users.every(hasText))) ||
        (action.permission.type === 0 && (!Array.isArray(users) || !users.length))
      )
        return bad();
    }
  }
}
export function validateMessagePayload(payload: QQMessagePayload): void {
  if (!isRecord(payload) || ![0, 2, 7].includes(payload.msg_type))
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid QQ message type');
  const messageReference = payload.msg_id !== undefined;
  if (
    (messageReference &&
      (typeof payload.msg_id !== 'string' ||
        !payload.msg_id ||
        !Number.isSafeInteger(payload.msg_seq) ||
        (payload.msg_seq ?? 0) <= 0)) ||
    (!messageReference && payload.msg_seq !== undefined) ||
    (messageReference && payload.event_id !== undefined) ||
    (payload.event_id !== undefined && (typeof payload.event_id !== 'string' || !payload.event_id))
  )
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid reply reference');
  if (
    payload.msg_type === 0 &&
    (typeof payload.content !== 'string' ||
      !payload.content.trim() ||
      payload.markdown !== undefined ||
      payload.media !== undefined ||
      payload.keyboard !== undefined)
  )
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid text payload');
  if (
    payload.msg_type === 7 &&
    (!isRecord(payload.media) ||
      typeof payload.media.file_info !== 'string' ||
      !payload.media.file_info ||
      (payload.content !== undefined && typeof payload.content !== 'string') ||
      payload.markdown !== undefined ||
      payload.keyboard !== undefined)
  )
    throw new FrameworkError('HANDLER_CONTRACT', 'Invalid media payload');
  if (payload.msg_type === 2) {
    const markdown = payload.markdown;
    if (
      !isRecord(markdown) ||
      payload.content !== undefined ||
      payload.media !== undefined ||
      !hasText(markdown.content) ||
      markdown.custom_template_id !== undefined ||
      markdown.params !== undefined
    )
      throw new FrameworkError('HANDLER_CONTRACT', 'Invalid Markdown payload');
    if (payload.keyboard !== undefined) validateKeyboard(payload.keyboard);
  }
}

export class HttpQQApi extends QQApi {
  constructor(
    private readonly config: ResolvedOptions,
    private readonly http: HttpRuntime,
    private readonly tokens: TokenManager,
    private readonly clock: Clock = systemClock,
  ) {
    super();
  }
  override async request<T = unknown>(
    method: HttpMethod,
    path: string,
    options: ApiRequestOptions = {},
  ): Promise<ApiResponse<T>> {
    return (await this.perform(method, path, options, false)) as ApiResponse<T>;
  }
  private async perform(
    method: HttpMethod,
    path: string,
    options: ApiRequestOptions,
    textResponse: boolean,
  ): Promise<ApiResponse<unknown>> {
    this.http.assertAllowed(options.signal);
    if (
      typeof path !== 'string' ||
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('\\') ||
      path.includes('#') ||
      hasControlCharacters(path, true)
    )
      throw new FrameworkError('CONFIG', 'QQ API path must be an origin-relative path');
    const url = new URL(path, this.config.api.baseUrl);
    if (url.origin !== this.config.api.baseUrl)
      throw new FrameworkError('CONFIG', 'QQ API origin changed');
    for (const [key, value] of Object.entries(options.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value));
    const serialized = options.body === undefined ? undefined : JSON.stringify(options.body);
    const deadline = this.http.deadline(options.timeoutMs);
    let token: string;
    try {
      token = await bounded(this.tokens.getToken(), deadline, options.signal, this.clock);
    } catch (error) {
      if (error instanceof FrameworkError && error.code === 'SHUTDOWN_TIMEOUT')
        throw new FrameworkError(
          'TRANSPORT',
          'QQ HTTP request timed out while waiting for a token',
        );
      throw error;
    }
    this.http.assertAllowed(options.signal);
    const { response, text } = await this.http.request(
      url.href,
      {
        method,
        headers: {
          Authorization: `QQBot ${token}`,
          'X-Union-Appid': this.config.appId,
          ...(serialized === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
      },
      options,
      false,
      deadline,
    );
    const traceId = response.headers.get('x-tps-trace-id') ?? undefined;
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : undefined;
    } catch {
      data = text;
    }
    const code = isRecord(data) ? data.code : undefined;
    if (!response.ok || (code !== undefined && code !== 0 && code !== '0')) {
      let message =
        isRecord(data) && typeof data.message === 'string'
          ? data.message
          : `QQ HTTP ${response.status}`;
      const sensitiveValues = [...this.tokens.sensitive(), token];
      const redact = (value: string) => {
        for (const sensitive of sensitiveValues)
          if (sensitive) value = value.split(sensitive).join('[redacted]');
        return value;
      };
      for (const sensitive of sensitiveValues)
        if (sensitive) message = message.split(sensitive).join('[redacted]');
      throw new QQApiError(message, {
        method,
        path,
        httpStatus: response.status,
        ...(typeof code === 'number' || typeof code === 'string'
          ? { qqCode: typeof code === 'string' ? redact(code) : code }
          : {}),
        ...(traceId === undefined ? {} : { traceId: redact(traceId) }),
      });
    }
    if (!textResponse && (data === undefined || typeof data === 'string'))
      throw new FrameworkError('PROTOCOL', 'QQ endpoint returned non-JSON data');
    return { data, status: response.status, ...(traceId === undefined ? {} : { traceId }) };
  }
  override async getSelf(options?: RequestOptions): Promise<BotUser> {
    const { data } = await this.request('GET', '/users/@me', options);
    if (!isRecord(data) || typeof data.id !== 'string' || !data.id)
      throw new FrameworkError('PROTOCOL', 'Missing QQ bot identity');
    return {
      id: data.id,
      ...(typeof data.username === 'string' ? { username: data.username } : {}),
      raw: data,
    };
  }
  override async getGateway(options?: RequestOptions): Promise<{ url: string }> {
    const { data } = await this.request('GET', '/gateway', options);
    if (!isRecord(data) || typeof data.url !== 'string')
      throw new FrameworkError('PROTOCOL', 'Missing QQ gateway URL');
    let url: URL;
    try {
      url = new URL(data.url);
    } catch {
      throw new FrameworkError('PROTOCOL', 'Invalid QQ gateway URL');
    }
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new FrameworkError('PROTOCOL', 'Invalid QQ gateway URL');
    return { url: url.href };
  }
  private async send(
    path: string,
    payload: QQMessagePayload,
    scene: 'group' | 'private',
    options?: RequestOptions,
  ): Promise<SendResult> {
    validateMessagePayload(payload);
    assertKeyboardScene(payload.keyboard, scene);
    const { data, traceId } = await this.request('POST', path, { ...options, body: payload });
    if (!isRecord(data)) throw new FrameworkError('PROTOCOL', 'Invalid QQ send response');
    const tracing = traceId === undefined ? {} : { traceId };
    if (typeof data.audit_id === 'string' && data.audit_id)
      return {
        status: 'pending-audit',
        auditId: data.audit_id,
        ...(typeof data.id === 'string' ? { messageId: data.id } : {}),
        ...tracing,
        raw: data,
      };
    if (typeof data.id !== 'string' || !data.id)
      throw new FrameworkError('PROTOCOL', 'Missing message or audit id');
    const timestamp = typeof data.timestamp === 'string' ? Date.parse(data.timestamp) : NaN;
    return {
      status: 'sent',
      messageId: data.id,
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
      ...tracing,
      raw: data,
    };
  }
  override sendGroupMessage(
    id: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> {
    return this.send(`/v2/groups/${segment(id)}/messages`, payload, 'group', options);
  }
  override sendPrivateMessage(
    id: string,
    payload: QQMessagePayload,
    options?: RequestOptions,
  ): Promise<SendResult> {
    return this.send(`/v2/users/${segment(id)}/messages`, payload, 'private', options);
  }
  private async upload(
    path: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> {
    if (
      !isRecord(payload) ||
      payload.file_type !== 1 ||
      payload.srv_send_msg !== false ||
      (payload.url === undefined) === (payload.file_data === undefined)
    )
      throw new FrameworkError('HANDLER_CONTRACT', 'Invalid image upload request');
    if (payload.url !== undefined) {
      let url: URL;
      try {
        url = new URL(payload.url);
      } catch {
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid image upload URL');
      }
      if (
        !hasText(payload.url) ||
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid image upload URL');
    } else {
      if (typeof payload.file_data !== 'string' || !payload.file_data)
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid base64 image data');
      if (payload.file_data.length > Math.ceil(this.config.api.maxUploadBytes / 3) * 4)
        throw new FrameworkError('RESOURCE_LIMIT', 'Image size is outside the configured limit');
      if (payload.file_data.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(payload.file_data))
        throw new FrameworkError('HANDLER_CONTRACT', 'Invalid base64 image data');
      if (Buffer.byteLength(payload.file_data, 'base64') > this.config.api.maxUploadBytes)
        throw new FrameworkError('RESOURCE_LIMIT', 'Image size is outside the configured limit');
    }
    const { data } = await this.request('POST', path, { ...options, body: payload });
    if (!isRecord(data) || typeof data.file_info !== 'string' || !data.file_info)
      throw new FrameworkError('PROTOCOL', 'Missing uploaded image info');
    const ttl = data.ttl === undefined ? undefined : lifetimeSeconds(data.ttl);
    return {
      file_info: data.file_info,
      ...(typeof data.file_uuid === 'string' ? { file_uuid: data.file_uuid } : {}),
      ...(ttl === undefined ? {} : { ttl }),
    };
  }
  override uploadGroupImage(
    id: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> {
    return this.upload(`/v2/groups/${segment(id)}/files`, payload, options);
  }
  override uploadPrivateImage(
    id: string,
    payload: QQUploadImagePayload,
    options?: RequestOptions,
  ): Promise<QQFileResult> {
    return this.upload(`/v2/users/${segment(id)}/files`, payload, options);
  }
  override async deleteGroupMessage(
    id: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.perform(
      'DELETE',
      `/v2/groups/${segment(id)}/messages/${segment(messageId)}`,
      options ?? {},
      true,
    );
  }
  override async deletePrivateMessage(
    id: string,
    messageId: string,
    options?: RequestOptions,
  ): Promise<void> {
    await this.perform(
      'DELETE',
      `/v2/users/${segment(id)}/messages/${segment(messageId)}`,
      options ?? {},
      true,
    );
  }
  override async acknowledgeInteraction(
    id: string,
    code = 0,
    options?: RequestOptions,
  ): Promise<void> {
    if (!Number.isSafeInteger(code) || code < 0)
      throw new FrameworkError('HANDLER_CONTRACT', 'Invalid interaction code');
    await this.perform('PUT', `/interactions/${segment(id)}`, { ...options, body: { code } }, true);
  }
}
