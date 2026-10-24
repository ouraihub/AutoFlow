/** What the Worker needs from the outside world. Adapters implement these; tests use fakes. */

export type ChannelName = 'telegram' | 'feishu'

/** A message from an allowed sender, whichever way it arrived (Telegram webhook, Feishu poll). */
export type InboundMessage = {
  chatId: string
  text: string
  /** Text of the message being replied to, when the channel provides it. */
  replyTo: string | null
}

/** Sends text into a chat of one platform. */
export interface ChatSender {
  readonly name: ChannelName
  send(chatId: string, text: string): Promise<void>
}
export type CreatedIssue = { number: number; url: string }
export type IssueState = 'open' | 'closed' | 'missing'
/** A task issue as /status needs it; `comments` are bodies, oldest first. */
export type TaskSnapshot = {
  number: number
  title: string
  open: boolean
  labels: readonly string[]
  comments: readonly string[]
}

export interface IssueTracker {
  createIssue(repo: string, issue: { title: string; body: string; labels: readonly string[] }): Promise<CreatedIssue>
  /** 'missing' covers unknown numbers and pull requests, which are not task issues. */
  issueState(repo: string, number: number): Promise<IssueState>
  comment(repo: string, number: number, body: string): Promise<{ url: string }>
  /** Most recently updated issues with `label`, open or closed, newest first. */
  recentTasks(repo: string, label: string, limit: number): Promise<TaskSnapshot[]>
}

/** Subset of Workers KV used here; a KVNamespace satisfies it directly. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
  delete(key: string): Promise<void>
}
