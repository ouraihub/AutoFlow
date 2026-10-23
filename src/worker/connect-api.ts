import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { Logger } from '../core/log.ts'
import type { AdminSession } from './admin-session.ts'
import type { ConnectionStore } from './connections.ts'
import { randomToken, type Sealer } from './crypto.ts'
import type { FeishuPoller } from './feishu-poller.ts'
import { FeishuClient, type FeishuRegistration } from './feishu.ts'
import type { KeyValueStore } from './ports.ts'
import { TelegramClient } from './telegram.ts'

const BIND_TTL_SECONDS = 600
export const TELEGRAM_HOOK_PATH = '/hook/telegram'

type Deps = {
  session: AdminSession
  connections: ConnectionStore
  registration: FeishuRegistration
  poller: (client: FeishuClient) => FeishuPoller
  sealer: Sealer
  kv: KeyValueStore
  log: Logger
  fetch: typeof fetch
}

/** JSON endpoints behind the /connect page. Every route except login requires an admin session. */
export class ConnectApi {
  readonly #deps: Deps

  constructor(deps: Deps) {
    this.#deps = deps
  }

  async handle(request: Request, route: string, nowMs: number): Promise<Response> {
    try {
      if (route === '/login' && request.method === 'POST') return await this.#login(request, nowMs)
      if (!(await this.#deps.session.valid(request, nowMs))) return json({ error: '请先登录' }, 401)
      const body = request.method === 'POST' ? await request.json().catch(() => null) : null
      switch (`${request.method} ${route}`) {
        case 'GET /state':
          return json(await this.#state())
        case 'POST /feishu/begin':
          return json(await this.#feishuBegin())
        case 'POST /feishu/poll':
          return json(await this.#feishuPoll(stringField(body, 'id'), nowMs))
        case 'POST /telegram/token':
          return json(await this.#telegramToken(stringField(body, 'token'), publicOrigin(request)))
        case 'POST /telegram/bind':
          return json(await this.#telegramBind())
        case 'POST /telegram/poll':
          return json(await this.#telegramPoll(stringField(body, 'id')))
        case 'POST /disconnect':
          return json(await this.#disconnect(stringField(body, 'channel')))
        default:
          return json({ error: '没有这个接口' }, 404)
      }
    } catch (error) {
      if (error instanceof AutoFlowError && error.code === 'rejected') return json({ error: error.message }, 400)
      this.#deps.log.error('connect api failed', { route, error })
      return json(
        {
          error:
            error instanceof AutoFlowError && error.code === 'upstream' ? '平台接口暂时不可用，请稍后重试' : '处理失败',
        },
        502,
      )
    }
  }

  async #login(request: Request, nowMs: number): Promise<Response> {
    const token = stringField(await request.json().catch(() => null), 'token')
    const cookie = await this.#deps.session.login(token, nowMs)
    if (!cookie) {
      this.#deps.log.warn('admin login failed')
      return json({ error: '管理口令不正确' }, 401)
    }
    return json({ ok: true }, 200, { 'set-cookie': cookie })
  }

  async #state(): Promise<unknown> {
    const [feishu, telegram] = await Promise.all([this.#deps.connections.feishu(), this.#deps.connections.telegram()])
    return {
      feishu: { connected: feishu !== null },
      telegram: {
        configured: telegram !== null,
        username: telegram?.botUsername ?? null,
        boundUsers: telegram?.userIds.length ?? 0,
      },
    }
  }

  async #feishuBegin(): Promise<unknown> {
    const start = await this.#deps.registration.begin()
    const id = randomToken()
    // The device code is what releases the app secret after the scan, so it stays server-side.
    await this.#deps.kv.put(`feishu:reg:${id}`, await this.#deps.sealer.seal(start.deviceCode), {
      expirationTtl: Math.max(60, start.expiresIn),
    })
    return { id, url: start.url, expiresIn: start.expiresIn }
  }

  async #feishuPoll(id: string, nowMs: number): Promise<unknown> {
    const sealed = await this.#deps.kv.get(`feishu:reg:${id}`)
    if (!sealed) return { status: 'failed', message: '二维码已过期，请重新扫码' }
    const result = await this.#deps.registration.poll(await this.#deps.sealer.open(sealed))
    if (result.status === 'pending') return result
    await this.#deps.kv.delete(`feishu:reg:${id}`)
    if (result.status === 'failed') {
      return {
        status: 'failed',
        message:
          result.reason === 'denied'
            ? '扫码后取消了授权'
            : result.reason === 'expired'
              ? '二维码已过期，请重新扫码'
              : '飞书注册失败，请重试',
      }
    }
    const client = new FeishuClient(result, this.#deps.kv, this.#deps.fetch)
    const chatId = await client.greet(
      result.openId,
      'AutoFlow 已连接。直接给我发需求，我会在 GitHub 上建任务；发 /help 查看用法。',
    )
    await this.#deps.connections.saveFeishu({
      appId: result.appId,
      appSecret: result.appSecret,
      openId: result.openId,
      chatId,
    })
    await this.#deps.poller(client).reset(nowMs)
    this.#deps.log.info('feishu connected')
    return { status: 'done' }
  }

  async #telegramToken(botToken: string, origin: string): Promise<unknown> {
    if (!/^\d+:[\w-]{30,}$/.test(botToken))
      throw new AutoFlowError('rejected', '这不像 BotFather 给的 token（格式是 数字:字母串）')
    const client = new TelegramClient(botToken, this.#deps.fetch)
    let username: string
    try {
      username = await client.username()
    } catch (cause) {
      throw new AutoFlowError('rejected', '电报不认这个 token，请到 @BotFather 重新复制', { cause })
    }
    // Telegram only delivers to HTTPS. Behind wrangler dev + tunnel the Worker sees http://localhost, so
    // the address comes from the admin's browser (publicOrigin) and must be https.
    if (!origin.startsWith('https://')) {
      throw new AutoFlowError(
        'rejected',
        `电报只能回调 HTTPS 地址，当前页面地址是 ${origin}，请通过 https 地址打开本页`,
      )
    }
    const webhookSecret = randomToken()
    await client.setWebhook(`${origin}${TELEGRAM_HOOK_PATH}`, webhookSecret)
    this.#deps.log.info('telegram webhook set', { origin })
    const previous = await this.#deps.connections.telegram()
    // Same bot again keeps its bound users; a new bot starts with nobody bound.
    const userIds = previous?.botToken === botToken ? previous.userIds : []
    await this.#deps.connections.saveTelegram({ botToken, botUsername: username, webhookSecret, userIds })
    this.#deps.log.info('telegram configured', { bot: username })
    return { ok: true }
  }

  async #telegramBind(): Promise<unknown> {
    const connection = await this.#deps.connections.telegram()
    if (!connection) throw new AutoFlowError('rejected', '请先保存电报 bot token')
    const id = randomToken()
    await this.#deps.kv.put(`telegram:bind:${id}`, 'pending', { expirationTtl: BIND_TTL_SECONDS })
    return { id, url: `https://t.me/${connection.botUsername}?start=${id}`, expiresIn: BIND_TTL_SECONDS }
  }

  async #telegramPoll(id: string): Promise<unknown> {
    const state = await this.#deps.kv.get(`telegram:bind:${id}`)
    if (state === 'done') return { status: 'done' }
    if (state === 'pending') return { status: 'pending' }
    return { status: 'failed', message: '二维码已过期，请重新扫码' }
  }

  async #disconnect(channel: string): Promise<unknown> {
    if (channel === 'telegram') {
      const connection = await this.#deps.connections.telegram()
      // Best effort: a bot whose token was revoked cannot be reached, but should still disconnect.
      if (connection)
        await new TelegramClient(connection.botToken, this.#deps.fetch).deleteWebhook().catch(() => undefined)
      await this.#deps.connections.disconnect('telegram')
    } else if (channel === 'feishu') {
      await this.#deps.connections.disconnect('feishu')
    } else {
      throw new AutoFlowError('rejected', '未知渠道')
    }
    this.#deps.log.info('channel disconnected', { channel })
    return { ok: true }
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })
}

function stringField(body: unknown, name: string): string {
  const value = readPath(body, [name])
  if (typeof value !== 'string' || !value.trim()) throw new AutoFlowError('rejected', `缺少 ${name}`)
  return value.trim()
}

/**
 * The public address of this Worker. In production request.url is already https. Behind wrangler dev
 * with a tunnel, request.url and Origin are rewritten to http:// while x-forwarded-proto stays "https".
 * Only the scheme is taken from the header (upgrading the same host to https), so spoofing it is harmless.
 */
function publicOrigin(request: Request): string {
  const url = new URL(request.url)
  if (request.headers.get('x-forwarded-proto') === 'https') url.protocol = 'https:'
  return url.origin
}
