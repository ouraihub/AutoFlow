import { AutoFlowError } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import type { CreatedIssue, IssueState, IssueTracker, TaskSnapshot } from './ports.ts'

const API = 'https://api.github.com'
const ERROR_BODY_CHARS = 300

/** IssueTracker over the GitHub REST API. The token only needs Issues read/write on the target repos. */
export class GitHubIssues implements IssueTracker {
  readonly #token: string
  readonly #fetch: typeof fetch

  constructor(token: string, fetcher: typeof fetch = fetch) {
    this.#token = token
    // Wrapped: calling the global fetch as `this.#fetch(...)` throws "Illegal invocation" in Workers.
    this.#fetch = (input, init) => fetcher(input, init)
  }

  async createIssue(
    repo: string,
    issue: { title: string; body: string; labels: readonly string[] },
  ): Promise<CreatedIssue> {
    const created = await this.#request('POST', `/repos/${repo}/issues`, issue)
    const number = readPath(created, ['number'])
    const url = readPath(created, ['html_url'])
    if (typeof number !== 'number' || typeof url !== 'string') {
      throw new AutoFlowError('upstream', 'GitHub returned an issue without number or url', { context: { repo } })
    }
    return { number, url }
  }

  async issueState(repo: string, number: number): Promise<IssueState> {
    const issue = await this.#request('GET', `/repos/${repo}/issues/${number}`, null, { allowNotFound: true })
    if (issue === null) return 'missing'
    // The issues endpoint also returns pull requests; a follow-up must target a task issue.
    if (readPath(issue, ['pull_request']) !== undefined) return 'missing'
    return readPath(issue, ['state']) === 'open' ? 'open' : 'closed'
  }

  async comment(repo: string, number: number, body: string): Promise<{ url: string }> {
    const url = readPath(await this.#request('POST', `/repos/${repo}/issues/${number}/comments`, { body }), [
      'html_url',
    ])
    if (typeof url !== 'string')
      throw new AutoFlowError('upstream', 'GitHub returned a comment without url', { context: { repo, number } })
    return { url }
  }

  async recentTasks(repo: string, label: string, limit: number): Promise<TaskSnapshot[]> {
    const query = new URLSearchParams({ labels: label, state: 'all', sort: 'updated', per_page: String(limit) })
    const list = await this.#request('GET', `/repos/${repo}/issues?${query}`, null)
    if (!Array.isArray(list))
      throw new AutoFlowError('upstream', 'GitHub returned a non-list for issues', { context: { repo } })
    const issues = list.filter((issue: unknown) => readPath(issue, ['pull_request']) === undefined)
    return Promise.all(
      issues.map(async (issue: unknown): Promise<TaskSnapshot> => {
        const number = readPath(issue, ['number'])
        const title = readPath(issue, ['title'])
        if (typeof number !== 'number' || typeof title !== 'string') {
          throw new AutoFlowError('upstream', 'GitHub returned an issue without number or title', { context: { repo } })
        }
        const labels = readPath(issue, ['labels'])
        // ponytail: first 100 comments only; a task with more shows an older status until paging is added.
        const comments = await this.#request('GET', `/repos/${repo}/issues/${number}/comments?per_page=100`, null)
        return {
          number,
          title,
          open: readPath(issue, ['state']) === 'open',
          labels: Array.isArray(labels)
            ? labels.map((item: unknown) => readPath(item, ['name'])).filter((name) => typeof name === 'string')
            : [],
          comments: Array.isArray(comments)
            ? comments.map((item: unknown) => readPath(item, ['body'])).filter((body) => typeof body === 'string')
            : [],
        }
      }),
    )
  }

  async #request(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    options: { allowNotFound?: boolean } = {},
  ): Promise<unknown> {
    const response = await this.#fetch(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.#token}`,
        'user-agent': 'autoflow-worker',
        'x-github-api-version': '2022-11-28',
        ...(body === null ? {} : { 'content-type': 'application/json' }),
      },
      body: body === null ? null : JSON.stringify(body),
    })
    if (response.status === 404 && options.allowNotFound) return null
    if (!response.ok) {
      throw new AutoFlowError('upstream', `GitHub ${path} failed with HTTP ${response.status}`, {
        context: { status: response.status, body: (await response.text()).slice(0, ERROR_BODY_CHARS) },
      })
    }
    return response.json()
  }
}
