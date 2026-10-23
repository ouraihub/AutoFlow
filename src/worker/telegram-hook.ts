import type { Logger } from '../core/log.ts'
import type { ConnectionStore, TelegramConnection } from './connections.ts'
import { timingSafeEqual } from './crypto.ts'
import type { InboundMessage, KeyValueStore } from './ports.ts'
import { parseTelegramUpdate } from './telegram.ts'

const START = /^\/start(?:@\S+)?\s+([A-Za-z0-9_-]+)$/

export type HookResult =
  | { kind: 'rejected' }
  | { kind: 'ignored' }
  | { kind: 'bound'; connection: TelegramConnection; chatId: string }
  | { kind: 'message'; connection: TelegramConnection; message: InboundMessage }

/**
 * Telegram webhook. The secret header proves the call comes from Telegram for this bot. `/start <code>`
 * with a code issued by the /connect page binds the sender; afterwards only bound users are routed.
 */
export class TelegramHook {
  readonly #connections: ConnectionStore
  readonly #kv: KeyValueStore
  readonly #log: Logger

  constructor(deps: { connections: ConnectionStore; kv: KeyValueStore; log: Logger }) {
    this.#connections = deps.connections
    this.#kv = deps.kv
    this.#log = deps.log
  }

  async receive(request: Request): Promise<HookResult> {
    const connection = await this.#connections.telegram()
    const secret = request.headers.get('x-telegram-bot-api-secret-token') ?? ''
    if (!connection || !timingSafeEqual(secret, connection.webhookSecret)) return { kind: 'rejected' }

    const update = parseTelegramUpdate(await request.json().catch(() => null))
    if (!update) return { kind: 'ignored' }
    const chatId = String(update.chatId)

    const code = START.exec(update.text.trim())?.[1]
    if (code && (await this.#kv.get(`telegram:bind:${code}`)) === 'pending') {
      const userIds = connection.userIds.includes(update.userId)
        ? connection.userIds
        : [...connection.userIds, update.userId]
      const bound = { ...connection, userIds }
      await this.#connections.saveTelegram(bound)
      // Keep the code briefly so the page's next poll sees "done"; it cannot be reused after that.
      await this.#kv.put(`telegram:bind:${code}`, 'done', { expirationTtl: 120 })
      this.#log.info('telegram user bound', { users: userIds.length })
      return { kind: 'bound', connection: bound, chatId }
    }

    // Strangers get no reply, so the bot does not reveal that it is in use. The log line (no message
    // text) is how an owner who forgot to bind sees why the bot stays silent.
    if (!connection.userIds.includes(update.userId)) {
      this.#log.info('telegram message from unbound user ignored', {
        userId: update.userId,
        startWithCode: code !== undefined,
      })
      return { kind: 'ignored' }
    }
    return { kind: 'message', connection, message: { chatId, text: update.text, replyTo: update.replyTo } }
  }
}
