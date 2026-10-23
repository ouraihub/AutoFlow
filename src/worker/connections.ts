import { readPath } from '../core/guard.ts'
import type { Sealer } from './crypto.ts'
import type { KeyValueStore } from './ports.ts'

export type FeishuConnection = {
  appId: string
  appSecret: string
  /** The person who scanned; only their messages are accepted. */
  openId: string
  /** Their private chat with the bot, polled for new messages. */
  chatId: string
}

export type TelegramConnection = {
  botToken: string
  botUsername: string
  /** Sent by Telegram in X-Telegram-Bot-Api-Secret-Token on every webhook call. */
  webhookSecret: string
  /** Telegram user ids bound by scanning the bot link. */
  userIds: readonly number[]
}

const FEISHU = 'connection:feishu'
const TELEGRAM = 'connection:telegram'

/** Channel credentials from the /connect page, sealed with SECRET_KEY before they reach KV. */
export class ConnectionStore {
  readonly #kv: KeyValueStore
  readonly #sealer: Sealer

  constructor(kv: KeyValueStore, sealer: Sealer) {
    this.#kv = kv
    this.#sealer = sealer
  }

  async feishu(): Promise<FeishuConnection | null> {
    const value = await this.#read(FEISHU)
    const appId = readPath(value, ['appId'])
    const appSecret = readPath(value, ['appSecret'])
    const openId = readPath(value, ['openId'])
    const chatId = readPath(value, ['chatId'])
    if (
      typeof appId !== 'string' ||
      typeof appSecret !== 'string' ||
      typeof openId !== 'string' ||
      typeof chatId !== 'string'
    )
      return null
    return { appId, appSecret, openId, chatId }
  }

  saveFeishu(connection: FeishuConnection): Promise<void> {
    return this.#write(FEISHU, connection)
  }

  async telegram(): Promise<TelegramConnection | null> {
    const value = await this.#read(TELEGRAM)
    const botToken = readPath(value, ['botToken'])
    const botUsername = readPath(value, ['botUsername'])
    const webhookSecret = readPath(value, ['webhookSecret'])
    const userIds = readPath(value, ['userIds'])
    if (typeof botToken !== 'string' || typeof botUsername !== 'string' || typeof webhookSecret !== 'string')
      return null
    if (!Array.isArray(userIds) || !userIds.every((id) => typeof id === 'number')) return null
    return { botToken, botUsername, webhookSecret, userIds }
  }

  saveTelegram(connection: TelegramConnection): Promise<void> {
    return this.#write(TELEGRAM, connection)
  }

  disconnect(channel: 'feishu' | 'telegram'): Promise<void> {
    return this.#kv.delete(channel === 'feishu' ? FEISHU : TELEGRAM)
  }

  async #read(key: string): Promise<unknown> {
    const sealed = await this.#kv.get(key)
    if (!sealed) return null
    return JSON.parse(await this.#sealer.open(sealed))
  }

  async #write(key: string, value: unknown): Promise<void> {
    await this.#kv.put(key, await this.#sealer.seal(JSON.stringify(value)))
  }
}
