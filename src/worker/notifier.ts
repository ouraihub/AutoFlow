import type { Logger } from '../core/log.ts'
import type { ConnectionStore } from './connections.ts'
import type { ChatRef, ConversationStore } from './conversations.ts'
import type { Notice } from './github-events.ts'
import type { ChatSender, ChannelName } from './ports.ts'

/** Builds a sender for a connected channel, or null when that channel is not connected. */
export type SenderFactory = (channel: ChannelName) => Promise<ChatSender | null>

/** Delivers GitHub notices to chats. Failures are logged per chat and never thrown. */
export class Notifier {
  readonly #conversations: ConversationStore
  readonly #connections: ConnectionStore
  readonly #senders: SenderFactory
  readonly #log: Logger

  constructor(deps: {
    conversations: ConversationStore
    connections: ConnectionStore
    senders: SenderFactory
    log: Logger
  }) {
    this.#conversations = deps.conversations
    this.#connections = deps.connections
    this.#senders = deps.senders
    this.#log = deps.log
  }

  async deliver(repo: string, notice: Notice): Promise<void> {
    const chats = notice.to === 'all' ? await this.#everyChat() : await this.#issueChat(repo, notice.to.issue)
    for (const chat of chats) {
      try {
        const sender = await this.#senders(chat.channel)
        if (sender) await sender.send(chat.chatId, notice.text)
      } catch (error) {
        this.#log.error('notification failed', { channel: chat.channel, repo, error })
      }
    }
    this.#log.info('notification delivered', { repo, chats: chats.length, broadcast: notice.to === 'all' })
  }

  async #issueChat(repo: string, issue: number): Promise<ChatRef[]> {
    const chat = await this.#conversations.chatForIssue(repo, issue)
    return chat ? [chat] : []
  }

  /** Every bound person: Telegram private chats use the user id as chat id. */
  async #everyChat(): Promise<ChatRef[]> {
    const [telegram, feishu] = await Promise.all([this.#connections.telegram(), this.#connections.feishu()])
    return [
      ...(telegram?.userIds ?? []).map((id): ChatRef => ({ channel: 'telegram', chatId: String(id) })),
      ...(feishu ? [{ channel: 'feishu', chatId: feishu.chatId } satisfies ChatRef] : []),
    ]
  }
}
