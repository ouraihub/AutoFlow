/** What the reviewer needs from the outside world. Adapters implement these; tests use fakes. */

export type ChatMessage = { role: 'system' | 'user'; content: string }

/** A chat-completions model. Returns the assistant text or throws AutoFlowError('upstream'). */
export interface ModelClient {
  readonly name: string
  complete(messages: readonly ChatMessage[]): Promise<string>
}

export type PullRequest = {
  number: number
  title: string
  body: string
  /** Paths changed by the PR. */
  files: readonly string[]
  /** Unified diff, read as text only. */
  diff: string
}

/** The code host holding the PR. Only reads PR data and writes comments; never runs PR code. */
export interface PullRequestHost {
  pullRequest(number: number): Promise<PullRequest>
  /** Repository rules (AGENTS.md) from the PR's base, or null when the repository has none. */
  rules(number: number): Promise<string | null>
  comment(number: number, body: string): Promise<void>
}
