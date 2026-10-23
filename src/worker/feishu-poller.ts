import { readPath } from '../core/guard.ts'
import type { Logger } from '../core/log.ts'
import type { FeishuConnection } from './connections.ts'
import type { FeishuClient, FeishuMessage } from './feishu.ts'
import type { InboundMessage, KeyValueStore } from './ports.ts'

/**
 * Feishu's `start_time` is whole seconds and inclusive, so the cursor is (second, ids already seen in
 * that second): only the second would re-read the last message, second + 1 would skip later ones in it.
 */
export type Cursor = { seconds: number; seen: readonly string[] }

const CURSOR_KEY = 'feishu:cursor'

/** Returns the messages not seen before and the cursor to store. Pure, so the edge cases are testable. */
export function advanceCursor(
  cursor: Cursor,
  messages: readonly FeishuMessage[],
): { fresh: FeishuMessage[]; cursor: Cursor } {
  const fresh = messages.filter((message) => !cursor.seen.includes(message.id))
  let seconds = cursor.seconds
  for (const message of messages) seconds = Math.max(seconds, Math.floor(message.createdMs / 1000))
  const inLastSecond = messages
    .filter((message) => Math.floor(message.createdMs / 1000) === seconds)
    .map((message) => message.id)
  const seen = seconds === cursor.seconds ? [...new Set([...cursor.seen, ...inLastSecond])] : inLastSecond
  return { fresh, cursor: { seconds, seen } }
}

/** One poll of the connected person's private chat; runs from the Worker's cron trigger. */
export class FeishuPoller {
  readonly #client: FeishuClient
  readonly #kv: KeyValueStore
  readonly #log: Logger

  constructor(deps: { client: FeishuClient; kv: KeyValueStore; log: Logger }) {
    this.#client = deps.client
    this.#kv = deps.kv
    this.#log = deps.log
  }

  /** Messages from `connection.openId` since the last poll. The cursor starts at connect time. */
  async poll(connection: FeishuConnection, nowMs: number): Promise<InboundMessage[]> {
    const stored: unknown = JSON.parse((await this.#kv.get(CURSOR_KEY)) ?? 'null')
    const seconds = readPath(stored, ['seconds'])
    const seen = readPath(stored, ['seen'])
    const cursor: Cursor =
      typeof seconds === 'number' && Array.isArray(seen) && seen.every((id) => typeof id === 'string')
        ? { seconds, seen }
        : { seconds: Math.floor(nowMs / 1000), seen: [] }

    const messages = await this.#client.messagesSince(connection.chatId, cursor.seconds)
    const next = advanceCursor(cursor, messages)
    await this.#kv.put(CURSOR_KEY, JSON.stringify(next.cursor))

    const inbound = next.fresh.flatMap((message) =>
      message.senderOpenId === connection.openId && message.text
        ? [{ chatId: connection.chatId, text: message.text, replyTo: null }]
        : [],
    )
    if (inbound.length) this.#log.info('feishu messages received', { count: inbound.length })
    return inbound
  }

  /** Called on (re)connect so messages sent before the connection are not treated as tasks. */
  async reset(nowMs: number): Promise<void> {
    await this.#kv.put(CURSOR_KEY, JSON.stringify({ seconds: Math.floor(nowMs / 1000), seen: [] }))
  }
}
