/** Narrowing helpers for data from outside the process (JSON, CLI output, thrown values). */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Walks `path` through nested objects and arrays, returning undefined as soon as a step is missing.
 * The result is unknown: callers still check its type before use.
 */
export function readPath(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value
  for (const key of path) {
    if (typeof key === 'number') {
      if (!Array.isArray(current)) return undefined
      current = current[key]
    } else {
      if (!isRecord(current) || !(key in current)) return undefined
      current = current[key]
    }
  }
  return current
}
