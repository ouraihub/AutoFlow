/** Path prefixes agents may not change and reviews treat strictly, from a comma-separated input. */
export function parseProtectedPaths(raw: string | undefined): string[] {
  return (raw || '.github/')
    .split(',')
    .map((prefix) => prefix.trim())
    .filter(Boolean)
}

export function touchedProtected(files: readonly string[], prefixes: readonly string[]): string[] {
  return files.filter((path) => prefixes.some((prefix) => path.startsWith(prefix)))
}
