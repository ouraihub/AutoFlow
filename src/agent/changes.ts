import { touchedProtected } from '../core/protected-paths.ts'
import type { Phase } from './phase.ts'

/**
 * Files an agent run may not have changed. Enforced on the pushed commits, not left to the prompt:
 * protected paths never, and a design run may only change its design document.
 */
export function forbiddenChanges(
  files: readonly string[],
  rules: { phase: Phase; docPath: string; protectedPaths: readonly string[] },
): string[] {
  const forbidden = new Set(touchedProtected(files, rules.protectedPaths))
  if (rules.phase === 'design') for (const file of files) if (file !== rules.docPath) forbidden.add(file)
  return [...forbidden]
}

/** Task checklist progress in the design document (`- [x]` / `- [ ]` items). */
export function progress(doc: string): { done: number; total: number } {
  const items = doc.match(/^\s*[-*] \[[ xX]\]/gm) ?? []
  return { done: items.filter((item) => /\[[xX]\]/.test(item)).length, total: items.length }
}
