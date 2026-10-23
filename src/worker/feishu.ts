import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { ChatSender, KeyValueStore } from './ports.ts'

const ACCOUNTS = 'https://accounts.feishu.cn/oauth/v1/app/registration'
const API = 'https://open.feishu.cn/open-apis'
const TOKEN_MARGIN_SECONDS = 300
const MIN_KV_TTL_SECONDS = 60
const PAGE_SIZE = 50

export type RegistrationStart = { deviceCode: string; url: string; expiresIn: number }
export type RegistrationPoll =
  | { status: 'pending' }
  | { status: 'done'; appId: string; appSecret: string; openId: string }
  | { status: 'failed'; reason: 'denied' | 'expired' | 'error' }

/**
 * Creates a Feishu bot app by QR scan (device flow on accounts.feishu.cn). The person scanning gets a
 * self-built app; we get its App ID / App Secret and their open_id. No developer console step.
 */
export class FeishuRegistration {
  readonly #fetch: typeof fetch

  constructor(fetcher: typeof fetch = fetch) {
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  async begin(): Promise<RegistrationStart> {
    await this.#post({ action: 'init' })
    const res = await this.#post({
      action: 'begin',
      archetype: 'PersonalAgent',
      auth_method: 'client_secret',
      request_user_info: 'open_id',
    })
    const deviceCode = readPath(res, ['device_code'])
    const url = readPath(res, ['verification_uri_complete'])
    const expiresIn = readPath(res, ['expires_in'])
    if (typeof deviceCode !== 'string' || typeof url !== 'string') {
      throw new AutoFlowError('upstream', 'feishu registration begin returned no QR', {
        context: { error: readPath(res, ['error']) },
      })
    }
    return { deviceCode, url, expiresIn: typeof expiresIn === 'number' ? expiresIn : 600 }
  }

  /** One poll; the browser calls it every few seconds, so no Worker request has to wait for the scan. */
  async poll(deviceCode: string): Promise<RegistrationPoll> {
    const res = await this.#post({ action: 'poll', device_code: deviceCode })
    const appId = readPath(res, ['client_id'])
    const appSecret = readPath(res, ['client_secret'])
    const openId = readPath(res, ['user_info', 'open_id'])
    if (typeof appId === 'string' && typeof appSecret === 'string' && typeof openId === 'string') {
      return { status: 'done', appId, appSecret, openId }
    }
    switch (readPath(res, ['error'])) {
      case 'authorization_pending':
      case 'slow_down':
      case undefined:
        return { status: 'pending' }
      case 'access_denied':
        return { status: 'failed', reason: 'denied' }
      case 'expired_token':
        return { status: 'failed', reason: 'expired' }
      default:
        return { status: 'failed', reason: 'error' }
    }
  }

  async #post(params: Record<string, string>): Promise<unknown> {
    const response = await this.#fetch(ACCOUNTS, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    })
    // OAuth device flow answers pending/denied/expired as HTTP 400 with an `error` field, so the body
    // decides; only a 5xx or a non-JSON body is an upstream failure.
    const data: unknown = await response.json().catch(() => null)
    if (response.status >= 500 || data === null) {
      throw new AutoFlowError('upstream', `feishu registration failed with HTTP ${response.status}`)
    }
    return data
  }
}

export type FeishuMessage = { id: string; createdMs: number; senderOpenId: string | null; text: string | null }

/** Feishu bot API for one app. Feishu reports failures as HTTP 200 with `code != 0`, so every call checks it. */
export class FeishuClient implements ChatSender {
  readonly name = 'feishu'
  readonly #appId: string
  readonly #appSecret: string
  readonly #kv: KeyValueStore
  readonly #fetch: typeof fetch

  constructor(app: { appId: string; appSecret: string }, kv: KeyValueStore, fetcher: typeof fetch = fetch) {
    this.#appId = app.appId
    this.#appSecret = app.appSecret
    this.#kv = kv
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.#call('POST', '/im/v1/messages?receive_id_type=chat_id', {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    })
  }

  /** Sends to a person by open_id and returns the private chat id, which is what gets polled later. */
  async greet(openId: string, text: string): Promise<string> {
    const data = await this.#call('POST', '/im/v1/messages?receive_id_type=open_id', {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    })
    const chatId = readPath(data, ['data', 'chat_id'])
    if (typeof chatId !== 'string') throw new AutoFlowError('upstream', 'feishu message reply has no chat_id')
    return chatId
  }

  /** Messages in `chatId` created at or after `startSeconds`, oldest first (Feishu's bound is inclusive). */
  async messagesSince(chatId: string, startSeconds: number): Promise<FeishuMessage[]> {
    const query = new URLSearchParams({
      container_id_type: 'chat',
      container_id: chatId,
      sort_type: 'ByCreateTimeAsc',
      start_time: String(startSeconds),
      page_size: String(PAGE_SIZE),
    })
    const items = readPath(await this.#call('GET', `/im/v1/messages?${query}`, null), ['data', 'items'])
    if (!Array.isArray(items)) return []
    return items.flatMap((item: unknown) => {
      const id = readPath(item, ['message_id'])
      const created = Number(readPath(item, ['create_time']))
      if (typeof id !== 'string' || !Number.isFinite(created)) return []
      const fromUser = readPath(item, ['sender', 'sender_type']) === 'user'
      const sender = readPath(item, ['sender', 'id'])
      const content = readPath(item, ['body', 'content'])
      let text: string | null = null
      if (readPath(item, ['msg_type']) === 'text' && typeof content === 'string') {
        try {
          const parsed = readPath(JSON.parse(content), ['text'])
          text = typeof parsed === 'string' ? parsed.trim() : null
        } catch {
          text = null
        }
      }
      return [{ id, createdMs: created, senderOpenId: fromUser && typeof sender === 'string' ? sender : null, text }]
    })
  }

  async #call(method: 'GET' | 'POST', path: string, body: unknown): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.#token()}`, 'content-type': 'application/json; charset=utf-8' },
      ...(body === null ? {} : { body: JSON.stringify(body) }),
    })
    const data: unknown = await response.json().catch(() => null)
    const code = readPath(data, ['code'])
    if (!response.ok || code !== 0) {
      throw new AutoFlowError('upstream', `feishu ${path.split('?')[0]} failed`, {
        context: { status: response.status, code, msg: readPath(data, ['msg']) },
      })
    }
    return data
  }

  async #token(): Promise<string> {
    const cacheKey = `feishu:token:${this.#appId}`
    const cached = await this.#kv.get(cacheKey)
    if (cached) return cached
    const response = await this.#fetch(`${API}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.#appId, app_secret: this.#appSecret }),
    })
    const data: unknown = await response.json().catch(() => null)
    const token = readPath(data, ['tenant_access_token'])
    const expire = readPath(data, ['expire'])
    if (readPath(data, ['code']) !== 0 || typeof token !== 'string' || typeof expire !== 'number') {
      throw new AutoFlowError('upstream', 'feishu tenant token request failed', {
        context: { code: readPath(data, ['code']) },
      })
    }
    await this.#kv.put(cacheKey, token, { expirationTtl: Math.max(MIN_KV_TTL_SECONDS, expire - TOKEN_MARGIN_SECONDS) })
    return token
  }
}
