import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { KeyEntry } from '../core/key-pool.ts'
import type { ChatMessage, ModelClient } from './ports.ts'

const ERROR_BODY_CHARS = 500
/** The key itself was refused (invalid, out of quota, rate limited): the next key may succeed. */
const NEXT_KEY_STATUS = [401, 403, 429]

/**
 * Chat-completions client over a pool of OpenAI-compatible relays. Keys are tried in order; only a
 * 401/403/429 moves to the next key, each key at most once. Network errors and 5xx fail at once, since
 * another key would not help (same rule as AutoNote's withKeys).
 */
export class OpenAiCompatibleModel implements ModelClient {
  readonly name: string
  readonly #keys: readonly KeyEntry[]
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: { keys: readonly KeyEntry[]; model: string; timeoutMs?: number; fetch?: typeof fetch }) {
    if (options.keys.length === 0) throw new AutoFlowError('config', 'the key pool is empty')
    this.#keys = options.keys
    this.name = options.model
    this.#timeoutMs = options.timeoutMs ?? 300_000
    const fetcher = options.fetch ?? fetch
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  async complete(messages: readonly ChatMessage[]): Promise<string> {
    const body = JSON.stringify({ model: this.name, temperature: 0, messages })
    for (const [index, key] of this.#keys.entries()) {
      const url = `${key.baseUrl}/chat/completions`
      let response: Response
      try {
        response = await this.#fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key.apiKey}` },
          body,
          signal: AbortSignal.timeout(this.#timeoutMs),
        })
      } catch (cause) {
        throw new AutoFlowError('upstream', 'model request did not complete', {
          cause,
          context: { url, key: index + 1 },
        })
      }
      const last = index === this.#keys.length - 1
      if (NEXT_KEY_STATUS.includes(response.status) && !last) continue
      if (!response.ok) {
        throw new AutoFlowError('upstream', `model request failed with HTTP ${response.status}`, {
          context: {
            url,
            key: index + 1,
            status: response.status,
            body: (await response.text()).slice(0, ERROR_BODY_CHARS),
            poolExhausted: NEXT_KEY_STATUS.includes(response.status),
          },
        })
      }
      const content = readPath(await response.json().catch(() => null), ['choices', 0, 'message', 'content'])
      if (typeof content !== 'string') {
        throw new AutoFlowError('upstream', 'model response has no message content', {
          context: { url, key: index + 1 },
        })
      }
      return content
    }
    // Unreachable: the last key either returns or throws above.
    throw new AutoFlowError('upstream', 'the key pool is empty')
  }
}
