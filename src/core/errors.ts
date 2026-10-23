/**
 * Every failure AutoFlow raises on purpose is an AutoFlowError with a stable code. Callers branch on
 * `code`, never on message text; the message is for people and logs. Unknown errors are wrapped once
 * at the boundary that catches them, keeping the original as `cause`.
 */
export type ErrorCode =
  /** Missing or malformed configuration (env, secrets, inputs). Not retryable. */
  | 'config'
  /** A remote service (model relay, GitHub, chat API) failed or returned something unusable. */
  | 'upstream'
  /** A request reached us that fails validation or authentication. */
  | 'rejected'

export class AutoFlowError extends Error {
  override readonly name = 'AutoFlowError'
  readonly code: ErrorCode
  /** Structured details for logs; never put secrets here. */
  readonly context: Readonly<Record<string, unknown>>

  constructor(code: ErrorCode, message: string, options: { cause?: unknown; context?: Record<string, unknown> } = {}) {
    super(message, { cause: options.cause })
    this.code = code
    this.context = options.context ?? {}
  }
}

/** Reads a required variable from an env-like record. */
export function requireEnv(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim()
  if (!value) throw new AutoFlowError('config', `${name} is not set`)
  return value
}
