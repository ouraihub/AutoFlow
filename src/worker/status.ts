import { DEVELOP_LABEL, decidePhase } from '../core/phase.ts'
import type { TaskSnapshot } from './ports.ts'

/** First line of an agent workflow report on the task issue; see src/agent/publish.ts. */
const REPORT = /^AutoFlow agent: (design ready|paused|opened|updated|failed)\./
const PROGRESS = /任务 (\d+\/\d+)/

/**
 * One task's stage, read from the issue alone: the newest agent report says where the last run ended,
 * and a reply after it means the workflow has been triggered again (queued or running).
 */
export function taskStatus(task: TaskSnapshot): string {
  if (!task.open) return '已完成'
  const last = task.comments.findLastIndex((body) => REPORT.test(body))
  if (last < 0) return '设计中'
  const body = task.comments[last] ?? ''
  const replies = task.comments.slice(last + 1)
  const approved = task.labels.includes(DEVELOP_LABEL)
  if (replies.length > 0) {
    const develops = replies.some(
      (comment) => decidePhase({ event: 'issue_comment', comment, hasDoc: true, approved }) === 'develop',
    )
    if (develops) return '开发中'
    return body.startsWith('AutoFlow agent: design ready.') ? '修改设计中' : '设计中'
  }
  switch (REPORT.exec(body)?.[1]) {
    case 'design ready':
      return '设计完成，等你确认'
    case 'paused': {
      const progress = PROGRESS.exec(body)?.[1]
      return progress ? `已暂停 ${progress}，回复「继续」` : '已暂停，回复「继续」'
    }
    case 'opened':
    case 'updated':
      return 'PR 审查中'
    default:
      return '运行失败'
  }
}

/** The /status reply: open tasks first, then recently finished ones, each as `alias#N stage · title`. */
export function formatStatus(alias: string, tasks: readonly TaskSnapshot[]): string {
  if (tasks.length === 0) return `${alias} 还没有需求。`
  const ordered = [...tasks.filter((task) => task.open), ...tasks.filter((task) => !task.open)]
  return [
    `${alias} 的需求：`,
    ...ordered.map((task) => `${alias}#${task.number} ${taskStatus(task)} · ${task.title}`),
  ].join('\n')
}
