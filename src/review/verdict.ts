export type Verdict = { verdict: 'approve' | 'request_changes'; issues: readonly string[] }

const MAX_ISSUES = 30

/**
 * Extracts the model's verdict. Returns null for anything that is not a well-formed verdict, so the
 * caller fails closed. An approval that still lists problems is downgraded to request_changes.
 */
export function parseVerdict(raw: string): Verdict | null {
  const json = raw.match(/\{[\s\S]*\}/)?.[0]
  if (!json) return null
  let value: unknown
  try {
    value = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const { verdict, issues: rawIssues } = value as { verdict?: unknown; issues?: unknown }
  if (verdict !== 'approve' && verdict !== 'request_changes') return null
  const issues = Array.isArray(rawIssues)
    ? rawIssues.filter((issue): issue is string => typeof issue === 'string').slice(0, MAX_ISSUES)
    : []
  return verdict === 'approve' && issues.length > 0 ? { verdict: 'request_changes', issues } : { verdict, issues }
}

/** PR comment whose first line the chat bridge matches on; keep the prefix stable. */
export function formatVerdict(model: string, { verdict, issues }: Verdict): string {
  if (verdict === 'approve') return `AI review (${model}): approved.`
  return `AI review (${model}): changes requested.\n\n${issues.map((issue) => `- ${issue}`).join('\n')}`
}
