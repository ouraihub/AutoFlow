import { AutoFlowError } from '../core/errors.ts'
import type { Logger } from '../core/log.ts'
import { parseCommand } from './commands.ts'
import type { Config, RepoTarget } from './config.ts'
import type { ConversationStore } from './conversations.ts'
import type { ChatSender, InboundMessage, IssueTracker } from './ports.ts'

export const AGENT_LABEL = 'agent'
const MAX_TITLE = 80

const HELP_TEXT = [
  'AutoFlow 用法：',
  '直接发送需求 → 在默认仓库建任务',
  '@<别名> 需求 → 在指定仓库建任务',
  '#12 补充 或 <别名>#12 补充 → 给任务追加说明（也可以直接回复 bot 的消息）',
  '/use <别名> → 设置本会话的默认仓库',
  '/repos → 列出可用仓库',
].join('\n')

/** Turns a verified chat message into an issue or comment and replies with the result. */
export class TaskRouter {
  readonly #issues: IssueTracker
  readonly #conversations: ConversationStore
  readonly #config: Pick<Config, 'repos' | 'defaultAlias'>
  readonly #log: Logger

  constructor(deps: {
    issues: IssueTracker
    conversations: ConversationStore
    config: Pick<Config, 'repos' | 'defaultAlias'>
    log: Logger
  }) {
    this.#issues = deps.issues
    this.#conversations = deps.conversations
    this.#config = deps.config
    this.#log = deps.log
  }

  /** Never throws: the platform has already been acknowledged, so failures are logged and reported in chat. */
  async handle(channel: ChatSender, message: InboundMessage): Promise<void> {
    const log = this.#log.child({ channel: channel.name, chatId: message.chatId })
    let reply: string | null
    try {
      reply = await this.#reply(channel, message, log)
    } catch (error) {
      log.error('chat command failed', { error })
      reply =
        error instanceof AutoFlowError && error.code === 'upstream'
          ? 'GitHub 暂时不可用，请稍后重试。'
          : '处理失败，请稍后重试。'
    }
    if (reply === null) return
    try {
      await channel.send(message.chatId, reply)
    } catch (error) {
      log.error('chat reply failed', { error })
    }
  }

  async #reply(channel: ChatSender, message: InboundMessage, log: Logger): Promise<string | null> {
    const chat = { channel: channel.name, chatId: message.chatId }
    const command = parseCommand(message.text, message.replyTo)
    switch (command.kind) {
      case 'empty':
        return null
      case 'help':
        return HELP_TEXT
      case 'repos':
        return this.#repoList()
      case 'use': {
        const target = this.#config.repos.get(command.alias)
        if (!target) return `没有仓库别名 ${command.alias}。\n${this.#repoList()}`
        await this.#conversations.setDefaultAlias(chat, target.alias)
        return `本会话默认仓库已设为 ${target.alias}（${target.repo}）。`
      }
      case 'task': {
        const target = await this.#target(chat, command.alias)
        if (!target) return `没有仓库别名 ${command.alias ?? ''}。\n${this.#repoList()}`
        const firstLine = command.text.split('\n', 1)[0] ?? ''
        const issue = await this.#issues.createIssue(target.repo, {
          title: firstLine.length > MAX_TITLE ? `${firstLine.slice(0, MAX_TITLE - 1)}…` : firstLine,
          body: `${command.text}\n\n---\n来源：${channel.name}`,
          labels: [AGENT_LABEL],
        })
        await this.#conversations.linkIssue(target.repo, issue.number, chat)
        log.info('task created', { repo: target.repo, issue: issue.number })
        // A plain follow-up message is a new task by design; the hint shows the two ways to add instead.
        return `收到需求 ${target.alias}#${issue.number}\n${issue.url}\n要补充这个需求：回复本条消息，或发送「#${issue.number} 补充内容」`
      }
      case 'followup': {
        const target = await this.#target(chat, command.alias)
        if (!target) return `没有仓库别名 ${command.alias ?? ''}。\n${this.#repoList()}`
        // A comment on a closed issue would never be worked on, and #N may name a pull request.
        const state = await this.#issues.issueState(target.repo, command.issue)
        if (state === 'missing') return `${target.alias}#${command.issue} 不是一个需求，请检查编号。`
        if (state === 'closed') {
          return `${target.alias}#${command.issue} 已经关闭，补充不会被处理。直接发送内容可以新建需求。`
        }
        const comment = await this.#issues.comment(
          target.repo,
          command.issue,
          `${command.text}\n\n---\n来源：${channel.name}`,
        )
        await this.#conversations.linkIssue(target.repo, command.issue, chat)
        log.info('followup added', { repo: target.repo, issue: command.issue })
        return `已补充到 ${target.alias}#${command.issue}\n${comment.url}`
      }
    }
  }

  async #target(
    chat: { channel: ChatSender['name']; chatId: string },
    alias: string | null,
  ): Promise<RepoTarget | null> {
    const chosen = alias ?? (await this.#conversations.defaultAlias(chat)) ?? this.#config.defaultAlias
    return this.#config.repos.get(chosen) ?? null
  }

  #repoList(): string {
    return ['可用仓库：', ...[...this.#config.repos.values()].map((target) => `${target.alias} → ${target.repo}`)].join(
      '\n',
    )
  }
}
