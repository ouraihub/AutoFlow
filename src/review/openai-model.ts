import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { ChatMessage, ModelClient } from './ports.ts'

const ERROR_BODY_CHARS = 500

/** Chat-completions client for any OpenAI-compatible relay. The base URL works with or without /v1. */
export class OpenAiCompatibleModel implements ModelClient {
  readonly name: string
  readonly url: string
  readonly #apiKey: string
  readonly #timeoutMs: number
  readonly #fetch: typeof fetch

  constructor(options: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number; fetch?: typeof fetch }) {
    const base = options.baseUrl.trim().replace(/\/+$/, '')
    this.url = `${base.endsWith('/v1') ? base : `${base}/v1`}/chat/completions`
    this.name = options.model
    this.#apiKey = options.apiKey
    this.#timeoutMs = options.timeoutMs ?? 300_000
    const fetcher = options.fetch ?? fetch
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  async complete(messages: readonly ChatMessage[]): Promise<string> {
    let response: Response
    try {
      response = await this.#fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.#apiKey}` },
        body: JSON.stringify({ model: this.name, temperature: 0, messages }),
        signal: AbortSignal.timeout(this.#timeoutMs),
      })
    } catch (cause) {
      throw new AutoFlowError('upstream', 'model request did not complete', { cause, context: { url: this.url } })
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, ERROR_BODY_CHARS)
      throw new AutoFlowError('upstream', `model request failed with HTTP ${response.status}`, {
        context: { url: this.url, status: response.status, body },
      })
    }
    const payload: unknown = await response.json().catch(() => null)
    const content = readPath(payload, ['choices', 0, 'message', 'content'])
    if (typeof content !== 'string') {
      throw new AutoFlowError('upstream', 'model response has no message content', { context: { url: this.url } })
    }
    return content
  }
}
