import { AutoFlowError } from './errors.ts'

/** One relay credential from the AI_KEYS secret. */
export type KeyEntry = { baseUrl: string; apiKey: string }

/**
 * AI_KEYS holds one `<base url> <api key>` per line, used in order; blank lines and `#` comments are
 * skipped. Errors name the line number only, never its content, because the content is a secret.
 */
export function parseKeyPool(raw: string): KeyEntry[] {
  const entries: KeyEntry[] = []
  raw.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim()
    if (!text || text.startsWith('#')) return
    const [baseUrl, apiKey, ...rest] = text.split(/\s+/)
    if (!baseUrl || !apiKey || rest.length > 0 || !/^https:\/\/\S+$/.test(baseUrl)) {
      throw new AutoFlowError('config', `AI_KEYS line ${index + 1} must be "<https base url> <api key>"`)
    }
    entries.push({ baseUrl: apiBase(baseUrl), apiKey })
  })
  if (entries.length === 0) throw new AutoFlowError('config', 'AI_KEYS has no entries')
  return entries
}

/** OpenAI-compatible base URL ending in /v1, accepted with or without it, like most clients. */
export function apiBase(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  return trimmed.endsWith('/v1') ? trimmed : `${trimmed}/v1`
}
