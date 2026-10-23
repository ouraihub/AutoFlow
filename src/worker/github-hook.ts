import { readPath } from '../core/guard.ts'
import type { RepoTarget } from './config.ts'
import { hmacHex, timingSafeEqual } from './crypto.ts'
import { noticeFor, type Notice } from './github-events.ts'

export const GITHUB_HOOK_PATH = '/hook/github'

export type GitHubHookResult =
  { kind: 'rejected' } | { kind: 'ignored' } | { kind: 'notice'; repo: string; notice: Notice }

/** Repository webhook. X-Hub-Signature-256 proves the delivery; only repositories in REPOS are handled. */
export class GitHubHook {
  readonly #secret: string
  readonly #repos: ReadonlyMap<string, RepoTarget>

  constructor(secret: string, repos: ReadonlyMap<string, RepoTarget>) {
    this.#secret = secret
    this.#repos = repos
  }

  async receive(request: Request): Promise<GitHubHookResult> {
    // The signature covers the exact bytes, so the body is read as text before parsing.
    const raw = await request.text()
    const signature = request.headers.get('x-hub-signature-256') ?? ''
    if (!timingSafeEqual(signature, `sha256=${await hmacHex(this.#secret, raw)}`)) return { kind: 'rejected' }

    let payload: unknown
    try {
      payload = JSON.parse(raw)
    } catch {
      return { kind: 'ignored' }
    }
    const repo = readPath(payload, ['repository', 'full_name'])
    const target = [...this.#repos.values()].find((candidate) => candidate.repo === repo)
    if (typeof repo !== 'string' || !target) return { kind: 'ignored' }

    const notice = noticeFor(request.headers.get('x-github-event') ?? '', payload, target)
    return notice ? { kind: 'notice', repo, notice } : { kind: 'ignored' }
  }
}
