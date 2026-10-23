import { readPath } from '../core/guard.ts'
import type { RepoTarget } from './config.ts'

/** Branches the agent workflow pushes to; the number is the task issue. */
const AGENT_BRANCH = /^agent\/issue-(\d+)$/
/** First line of the review workflow's PR comment; see src/review/verdict.ts formatVerdict. */
const REVIEW_REJECTED = /^AI review \([^)]*\): changes requested\./
/** First line of an agent workflow report on the task issue; see src/agent/publish.ts. */
const AGENT_REPORT = /^AutoFlow agent: (design ready|paused|updated|failed)\.\s*\n?([\s\S]*)$/
const AGENT_HEADLINE: Record<string, string> = {
  'design ready': '设计完成，等你确认',
  paused: '进度已保存',
  updated: 'PR 已更新',
  failed: '运行失败',
}
const MAX_REPORT_CHARS = 1800
const CLOSES = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?) #(\d+)\b/i
const MAX_POINTS = 5

/** Where a notification goes: the chat that asked for one issue, or every bound chat. */
export type Notice = { to: { issue: number } | 'all'; text: string }

/**
 * Turns one verified GitHub webhook delivery into at most one chat notification. Pure: everything it
 * needs is in the payload, so each event type is tested with recorded shapes.
 */
export function noticeFor(event: string, payload: unknown, target: RepoTarget): Notice | null {
  const action = readPath(payload, ['action'])

  if (event === 'pull_request') {
    const ref = readPath(payload, ['pull_request', 'head', 'ref'])
    const url = readPath(payload, ['pull_request', 'html_url'])
    const issue = typeof ref === 'string' ? AGENT_BRANCH.exec(ref)?.[1] : undefined
    if (!issue || typeof url !== 'string') return null
    if (action === 'opened')
      return { to: { issue: Number(issue) }, text: `${target.alias}#${issue} 已开 PR，等待审查和检查\n${url}` }
    if (action === 'closed' && readPath(payload, ['pull_request', 'merged']) === true) {
      return { to: { issue: Number(issue) }, text: `${target.alias}#${issue} 已合并 ✅\n${url}` }
    }
    return null
  }

  if (event === 'issue_comment' && action === 'created') {
    const body = readPath(payload, ['comment', 'body'])
    const url = readPath(payload, ['comment', 'html_url'])
    const number = readPath(payload, ['issue', 'number'])
    if (typeof body !== 'string' || typeof url !== 'string' || typeof number !== 'number') return null
    const points = body
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .slice(0, MAX_POINTS)

    if (readPath(payload, ['issue', 'pull_request']) !== undefined) {
      if (!REVIEW_REJECTED.test(body)) return null
      // The comment payload has no head branch; the task issue is the "Closes #N" in the PR body.
      const prBody = readPath(payload, ['issue', 'body'])
      const issue = typeof prBody === 'string' ? CLOSES.exec(prBody)?.[1] : undefined
      if (!issue) return null
      return { to: { issue: Number(issue) }, text: [`${target.alias}#${issue} 审查打回：`, ...points, url].join('\n') }
    }
    const report = AGENT_REPORT.exec(body)
    if (report?.[1]) {
      // The report is written for the chat already (summary, links, what to reply), so it is forwarded.
      const details = (report[2] ?? '').trim().slice(0, MAX_REPORT_CHARS)
      return {
        to: { issue: number },
        text: [`${target.alias}#${number} ${AGENT_HEADLINE[report[1]]}`, details].filter(Boolean).join('\n'),
      }
    }
    return null
  }

  if (event === 'workflow_run' && action === 'completed') {
    const name = readPath(payload, ['workflow_run', 'name'])
    const url = readPath(payload, ['workflow_run', 'html_url'])
    if (typeof name !== 'string' || typeof url !== 'string') return null
    if (readPath(payload, ['workflow_run', 'conclusion']) === 'success' && target.announce.includes(name)) {
      return { to: 'all', text: `${target.alias}「${name}」完成\n${url}` }
    }
  }
  return null
}
