import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GitHubIssues } from './github-issues.ts'

const answering = (status: number, body: unknown) =>
  new GitHubIssues('t', async () => new Response(JSON.stringify(body), { status }))

test('open and closed issues report their state', async () => {
  assert.equal(await answering(200, { state: 'open' }).issueState('o/r', 2), 'open')
  assert.equal(await answering(200, { state: 'closed' }).issueState('o/r', 3), 'closed')
})

test('a pull request number and an unknown number are both missing', async () => {
  assert.equal(await answering(200, { state: 'open', pull_request: { url: 'x' } }).issueState('o/r', 1), 'missing')
  assert.equal(await answering(404, { message: 'Not Found' }).issueState('o/r', 99), 'missing')
})

test('other failures are upstream errors', async () => {
  await assert.rejects(answering(500, {}).issueState('o/r', 2), { name: 'AutoFlowError', code: 'upstream' })
})
