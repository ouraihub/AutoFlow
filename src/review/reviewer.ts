import type { Logger } from '../core/log.ts'
import type { ModelClient, PullRequestHost } from './ports.ts'
import { buildPrompt } from './prompt.ts'
import { formatVerdict, parseVerdict, type Verdict } from './verdict.ts'

export type ReviewerOptions = {
  /** Path prefixes whose changes get the stricter review instruction. */
  protectedPaths: readonly string[]
  /** Diffs longer than this fail closed instead of being reviewed partially. */
  maxDiffChars: number
}

/**
 * Decides one PR and posts the verdict as a comment. The model only supplies text; this class
 * decides, so an instruction hidden in the diff cannot approve anything. Upstream failures propagate
 * (the check fails without a verdict comment) so a flaky relay is never recorded as a rejection.
 */
export class Reviewer {
  readonly #model: ModelClient
  readonly #host: PullRequestHost
  readonly #log: Logger
  readonly #options: ReviewerOptions

  constructor(deps: { model: ModelClient; host: PullRequestHost; log: Logger }, options: ReviewerOptions) {
    this.#model = deps.model
    this.#host = deps.host
    this.#log = deps.log
    this.#options = options
  }

  async review(number: number): Promise<Verdict> {
    const log = this.#log.child({ pr: number })
    const pr = await this.#host.pullRequest(number)
    const touched = pr.files.filter((path) => this.#options.protectedPaths.some((prefix) => path.startsWith(prefix)))
    log.info('review started', { files: pr.files.length, diffChars: pr.diff.length, protected: touched })

    let verdict: Verdict
    if (pr.diff.length > this.#options.maxDiffChars) {
      // ponytail: oversized diffs fail closed instead of being chunked; add chunked review if real PRs hit this.
      verdict = {
        verdict: 'request_changes',
        issues: [
          `Diff is ${pr.diff.length} characters, over the ${this.#options.maxDiffChars} review limit. Split the PR.`,
        ],
      }
    } else {
      const reply = await this.#model.complete(buildPrompt(pr, await this.#host.rules(number), touched))
      const parsed = parseVerdict(reply)
      if (!parsed) log.warn('unparseable model reply', { replyChars: reply.length })
      verdict = parsed ?? {
        verdict: 'request_changes',
        issues: ['The model did not return a valid verdict; failing closed.'],
      }
    }

    await this.#host.comment(number, formatVerdict(this.#model.name, verdict))
    log.info('review finished', { verdict: verdict.verdict, issues: verdict.issues.length })
    return verdict
  }
}
