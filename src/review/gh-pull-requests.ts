import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { PullRequest, PullRequestHost } from './ports.ts'

const run = promisify(execFile)
const MAX_BUFFER = 64 * 1024 * 1024
const STDERR_CHARS = 500

/** PullRequestHost backed by the `gh` CLI (preinstalled on GitHub runners, authenticated via GH_TOKEN). */
export class GhPullRequests implements PullRequestHost {
  readonly #repo: string

  constructor(repo: string) {
    this.#repo = repo
  }

  async pullRequest(number: number): Promise<PullRequest> {
    const view: unknown = JSON.parse(
      await this.#gh('pr', 'view', String(number), '-R', this.#repo, '--json', 'title,body,files'),
    )
    const title = readPath(view, ['title'])
    const body = readPath(view, ['body'])
    const files = readPath(view, ['files'])
    if (typeof title !== 'string' || typeof body !== 'string' || !Array.isArray(files)) {
      throw new AutoFlowError('upstream', 'gh pr view returned an unexpected shape', { context: { number } })
    }
    const paths = files.map((file: unknown) => readPath(file, ['path'])).filter((path) => typeof path === 'string')
    const diff = await this.#gh('pr', 'diff', String(number), '-R', this.#repo)
    return { number, title, body, files: paths, diff }
  }

  async rules(number: number): Promise<string | null> {
    const base = (
      await this.#gh('pr', 'view', String(number), '-R', this.#repo, '--json', 'baseRefOid', '--jq', '.baseRefOid')
    ).trim()
    try {
      return await this.#gh(
        'api',
        `repos/${this.#repo}/contents/AGENTS.md?ref=${base}`,
        '-H',
        'Accept: application/vnd.github.raw',
      )
    } catch (error) {
      if (error instanceof AutoFlowError && String(error.context['stderr']).includes('HTTP 404')) return null
      throw error
    }
  }

  async comment(number: number, body: string): Promise<void> {
    await this.#gh('pr', 'comment', String(number), '-R', this.#repo, '--body', body)
  }

  async #gh(...args: string[]): Promise<string> {
    try {
      return (await run('gh', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER })).stdout
    } catch (cause) {
      const stderr = readPath(cause, ['stderr'])
      throw new AutoFlowError('upstream', `gh ${args.slice(0, 2).join(' ')} failed`, {
        cause,
        context: { stderr: typeof stderr === 'string' ? stderr.slice(0, STDERR_CHARS) : null },
      })
    }
  }
}
