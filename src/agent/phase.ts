export type Phase = 'design' | 'develop'

/** Label the workflow adds when a design is approved; from then on every run develops. */
export const DEVELOP_LABEL = 'agent:develop'

/** Short replies that approve a design as-is. Anything longer is feedback, never approval. */
const APPROVAL = /^(?:确认|同意|开始开发|开发|可以|没问题|ok|okay|lgtm|approve|approved|go)[。.!！]?$/i

/** The text the person wrote: the chat bridge appends a `---` line and the channel name. */
export function ownText(comment: string): string {
  return comment.split(/\r?\n---\r?\n/, 1)[0]?.trim() ?? ''
}

/**
 * Every task is designed first: the agent writes the design document and stops. Development starts on
 * an explicit approval and stays on (DEVELOP_LABEL), so "继续" after an interruption resumes whichever
 * phase was running: an unapproved design continues designing, an approved one continues developing.
 */
export function decidePhase(input: {
  event: 'issues' | 'issue_comment'
  comment: string
  hasDoc: boolean
  approved: boolean
}): Phase {
  if (input.approved) return 'develop'
  if (!input.hasDoc) return 'design'
  return input.event === 'issue_comment' && APPROVAL.test(ownText(input.comment)) ? 'develop' : 'design'
}
