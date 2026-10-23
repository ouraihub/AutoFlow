import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoFlowError } from '../core/errors.ts'
import { JsonLogger } from '../core/log.ts'
import type { ChatMessage, ModelClient, PullRequest, PullRequestHost } from './ports.ts'
import { Reviewer } from './reviewer.ts'

class FakeHost implements PullRequestHost {
  readonly comments: string[] = []
  readonly pr: PullRequest

  constructor(pr: Partial<PullRequest> = {}) {
    this.pr = { number: 7, title: 't', body: '', files: ['src/a.ts'], diff: '+x', ...pr }
  }
  async pullRequest(): Promise<PullRequest> {
    return this.pr
  }
  async rules(): Promise<string | null> {
    return 'be careful'
  }
  async comment(_number: number, body: string): Promise<void> {
    this.comments.push(body)
  }
}

class FakeModel implements ModelClient {
  readonly name = 'fake'
  readonly calls: (readonly ChatMessage[])[] = []
  readonly #reply: string | Error

  constructor(reply: string | Error) {
    this.#reply = reply
  }
  async complete(messages: readonly ChatMessage[]): Promise<string> {
    this.calls.push(messages)
    if (this.#reply instanceof Error) throw this.#reply
    return this.#reply
  }
}

const silent = new JsonLogger({ sink: () => {} })
const reviewer = (model: ModelClient, host: PullRequestHost, maxDiffChars = 1000) =>
  new Reviewer({ model, host, log: silent }, { protectedPaths: ['.github/'], maxDiffChars })

test('approval is commented and returned', async () => {
  const host = new FakeHost()
  const result = await reviewer(new FakeModel('{"verdict":"approve","issues":[]}'), host).review(7)
  assert.equal(result.verdict, 'approve')
  assert.deepEqual(host.comments, ['AI review (fake): approved.'])
})

test('an unparseable reply fails closed', async () => {
  const host = new FakeHost()
  const result = await reviewer(new FakeModel('sure, ship it'), host).review(7)
  assert.equal(result.verdict, 'request_changes')
  assert.match(host.comments[0] ?? '', /changes requested/)
})

test('an oversized diff is rejected without calling the model', async () => {
  const model = new FakeModel('{"verdict":"approve","issues":[]}')
  const host = new FakeHost({ diff: 'x'.repeat(1001) })
  const result = await reviewer(model, host).review(7)
  assert.equal(result.verdict, 'request_changes')
  assert.equal(model.calls.length, 0)
})

test('protected paths and repository rules reach the prompt', async () => {
  const model = new FakeModel('{"verdict":"approve","issues":[]}')
  await reviewer(model, new FakeHost({ files: ['.github/workflows/ci.yml', 'src/a.ts'] })).review(7)
  const system = model.calls[0]?.[0]?.content ?? ''
  assert.match(system, /protected paths \(\.github\/workflows\/ci\.yml\)/)
  assert.match(system, /be careful/)
})

test('a model failure propagates and posts no verdict', async () => {
  const host = new FakeHost()
  const failure = new AutoFlowError('upstream', 'relay down')
  await assert.rejects(reviewer(new FakeModel(failure), host).review(7), failure)
  assert.deepEqual(host.comments, [])
})
