import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { ChatSender } from './ports.ts'

const MAX_TEXT = 4096

export type TelegramUpdate = { userId: number; chatId: number; text: string; replyTo: string | null }

/** Telegram Bot API for one bot. The token is in the URL, so errors never include the URL. */
export class TelegramClient implements ChatSender {
  readonly name = 'telegram'
  readonly #token: string
  readonly #fetch: typeof fetch

  constructor(botToken: string, fetcher: typeof fetch = fetch) {
    this.#token = botToken
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  /** Validates the token and returns the bot's username (for the t.me link). */
  async username(): Promise<string> {
    const username = readPath(await this.#call('getMe', {}), ['result', 'username'])
    if (typeof username !== 'string') throw new AutoFlowError('upstream', 'telegram getMe returned no username')
    return username
  }

  /** Points the bot at the Worker; Telegram then sends `secret` in X-Telegram-Bot-Api-Secret-Token. */
  async setWebhook(url: string, secret: string): Promise<void> {
    await this.#call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message'],
      drop_pending_updates: true,
    })
  }

  async deleteWebhook(): Promise<void> {
    await this.#call('deleteWebhook', { drop_pending_updates: true })
  }

  async send(chatId: string, text: string): Promise<void> {
    await this.#call('sendMessage', {
      chat_id: chatId,
      text: text.slice(0, MAX_TEXT),
      link_preview_options: { is_disabled: true },
    })
  }

  async #call(method: string, body: unknown): Promise<unknown> {
    let response: Response
    try {
      response = await this.#fetch(`https://api.telegram.org/bot${this.#token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch (cause) {
      throw new AutoFlowError('upstream', `telegram ${method} did not complete`, { cause })
    }
    const data: unknown = await response.json().catch(() => null)
    if (!response.ok || readPath(data, ['ok']) !== true) {
      throw new AutoFlowError('upstream', `telegram ${method} failed`, {
        context: { status: response.status, description: readPath(data, ['description']) },
      })
    }
    return data
  }
}

/** Text messages only; edits, stickers, joins and other update kinds return null. */
export function parseTelegramUpdate(update: unknown): TelegramUpdate | null {
  const userId = readPath(update, ['message', 'from', 'id'])
  const chatId = readPath(update, ['message', 'chat', 'id'])
  const text = readPath(update, ['message', 'text'])
  if (typeof userId !== 'number' || typeof chatId !== 'number' || typeof text !== 'string') return null
  const replyTo = readPath(update, ['message', 'reply_to_message', 'text'])
  return { userId, chatId, text, replyTo: typeof replyTo === 'string' ? replyTo : null }
}
