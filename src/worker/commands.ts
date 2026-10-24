import { ALIAS_PATTERN } from './config.ts'

export type Command =
  | { kind: 'empty' }
  | { kind: 'help' }
  | { kind: 'repos' }
  /** Progress of recent tasks; `alias` null = the chat's default repository. */
  | { kind: 'status'; alias: string | null }
  | { kind: 'use'; alias: string }
  /** New task; `alias` null = the chat's default repository. */
  | { kind: 'task'; alias: string | null; text: string }
  /** Addition to an existing issue. */
  | { kind: 'followup'; alias: string | null; issue: number; text: string }

const HELP = /^\/(?:help|start)(?:@\S+)?$/i
const REPOS = /^\/repos(?:@\S+)?$/i
const STATUS = /^\/status(?:@\S+)?(?:\s+(\S+))?$/i
const USE = /^\/use(?:@\S+)?\s+(\S+)$/i
const FOLLOWUP = new RegExp(`^(?:(${ALIAS_PATTERN}))?#(\\d+)\\s+([\\s\\S]+)$`, 'i')
const TARGETED = new RegExp(`^@(${ALIAS_PATTERN})\\s+([\\s\\S]+)$`, 'i')
/** The bot writes `alias#N` in its replies, so replying to one continues that issue. */
const REPLY_REF = new RegExp(`(?:^|\\s)(${ALIAS_PATTERN})#(\\d+)`, 'i')

export function parseCommand(input: string, replyTo: string | null): Command {
  const text = input.trim()
  if (!text) return { kind: 'empty' }
  if (HELP.test(text)) return { kind: 'help' }
  if (REPOS.test(text)) return { kind: 'repos' }
  const status = STATUS.exec(text)
  if (status) return { kind: 'status', alias: status[1]?.toLowerCase() ?? null }

  const use = USE.exec(text)
  if (use?.[1]) return { kind: 'use', alias: use[1].toLowerCase() }

  const followup = FOLLOWUP.exec(text)
  if (followup?.[2] && followup[3]) {
    return {
      kind: 'followup',
      alias: followup[1]?.toLowerCase() ?? null,
      issue: Number(followup[2]),
      text: followup[3].trim(),
    }
  }

  const ref = replyTo ? REPLY_REF.exec(replyTo) : null
  if (ref?.[1] && ref[2]) return { kind: 'followup', alias: ref[1].toLowerCase(), issue: Number(ref[2]), text }

  const targeted = TARGETED.exec(text)
  if (targeted?.[1] && targeted[2]) return { kind: 'task', alias: targeted[1].toLowerCase(), text: targeted[2].trim() }

  return { kind: 'task', alias: null, text }
}
