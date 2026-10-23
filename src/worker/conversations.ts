import type { ChannelName, KeyValueStore } from './ports.ts'

export type ChatRef = { channel: ChannelName; chatId: string }

const ISSUE_TTL_SECONDS = 90 * 24 * 3600

/** Per-chat default repository and issue → chat routing for notifications, kept in KV. */
export class ConversationStore {
  readonly #kv: KeyValueStore

  constructor(kv: KeyValueStore) {
    this.#kv = kv
  }

  defaultAlias(chat: ChatRef): Promise<string | null> {
    return this.#kv.get(`chat:${chat.channel}:${chat.chatId}`)
  }

  setDefaultAlias(chat: ChatRef, alias: string): Promise<void> {
    return this.#kv.put(`chat:${chat.channel}:${chat.chatId}`, alias)
  }

  /** Remembers which chat asked for `repo#number`, so GitHub events about it go back there. */
  linkIssue(repo: string, number: number, chat: ChatRef): Promise<void> {
    return this.#kv.put(`issue:${repo}#${number}`, JSON.stringify(chat), { expirationTtl: ISSUE_TTL_SECONDS })
  }
}
