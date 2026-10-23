import { AutoFlowError } from './errors.ts'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type LogFields = Readonly<Record<string, unknown>>

/**
 * Structured logging used by every module. One event per line; `msg` is a short constant phrase
 * (searchable), variable data goes into fields. Secrets never go into fields.
 */
export interface Logger {
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  /** Returns a logger that adds `fields` to every event, e.g. `{ repo, pr }`. */
  child(fields: LogFields): Logger
}

type Sink = (level: LogLevel, line: string) => void

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

/**
 * Writes JSON lines through console, which both Node and Workers route to their log streams
 * (Actions step log, `wrangler tail`). Error values in fields are expanded to name/code/message/stack.
 */
export class JsonLogger implements Logger {
  readonly #bound: LogFields
  readonly #min: LogLevel
  readonly #sink: Sink

  constructor(options: { level?: LogLevel; fields?: LogFields; sink?: Sink } = {}) {
    this.#bound = options.fields ?? {}
    this.#min = options.level ?? 'info'
    this.#sink = options.sink ?? ((level, line) => (level === 'error' ? console.error(line) : console.log(line)))
  }

  debug(msg: string, fields?: LogFields): void {
    this.#write('debug', msg, fields)
  }
  info(msg: string, fields?: LogFields): void {
    this.#write('info', msg, fields)
  }
  warn(msg: string, fields?: LogFields): void {
    this.#write('warn', msg, fields)
  }
  error(msg: string, fields?: LogFields): void {
    this.#write('error', msg, fields)
  }

  child(fields: LogFields): Logger {
    return new JsonLogger({ level: this.#min, fields: { ...this.#bound, ...fields }, sink: this.#sink })
  }

  #write(level: LogLevel, msg: string, fields: LogFields = {}): void {
    if (ORDER[level] < ORDER[this.#min]) return
    const event: Record<string, unknown> = { ts: new Date().toISOString(), level, msg, ...this.#bound }
    for (const [key, value] of Object.entries(fields))
      event[key] = value instanceof Error ? describeError(value) : value
    this.#sink(level, JSON.stringify(event))
  }
}

/** Serialisable view of an error chain, including AutoFlowError code and context. */
export function describeError(error: Error): Record<string, unknown> {
  const described: Record<string, unknown> = { name: error.name, message: error.message, stack: error.stack }
  if (error instanceof AutoFlowError) {
    described['code'] = error.code
    if (Object.keys(error.context).length) described['context'] = error.context
  }
  if (error.cause instanceof Error) described['cause'] = describeError(error.cause)
  else if (error.cause !== undefined) described['cause'] = String(error.cause)
  return described
}
