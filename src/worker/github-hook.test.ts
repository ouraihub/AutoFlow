import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JsonLogger } from '../core/log.ts'
import { ConnectionStore } from './connections.ts'
import { ConversationStore } from './conversations.ts'
import { Sealer, hmacHex } from './crypto.ts'
import { noticeFor } from './github-events.ts'
import { GitHubHook } from './github-hook.ts'
import { MemoryKv } from './memory-kv.test-support.ts'
import { Notifier } from './notifier.ts'
import type { ChannelName, ChatSender } from './ports.ts'

const demo = { alias: 'demo', repo: 'o/demo', announce: ['Release'] }
const repo = { full_name: 'o/demo' }

test('agent PRs notify when opened and when merged, other PRs do not', () => {
  const pr = (ref: string, extra = {}) => ({ head: { ref }, html_url: 'https://github.com/o/demo/pull/5', ...extra })
  assert.deepEqual(
    noticeFor('pull_request', { action: 'opened', pull_request: pr('agent/issue-2'), repository: repo }, demo),
    {
      to: { issue: 2 },
      text: 'demo#2 已开 PR，等待审查和检查\nhttps://github.com/o/demo/pull/5',
    },
  )
  const merged = noticeFor(
    'pull_request',
    { action: 'closed', pull_request: pr('agent/issue-2', { merged: true }) },
    demo,
  )
  assert.match(merged?.text ?? '', /^demo#2 已合并/)
  assert.equal(
    noticeFor('pull_request', { action: 'closed', pull_request: pr('agent/issue-2', { merged: false }) }, demo),
    null,
  )
  assert.equal(noticeFor('pull_request', { action: 'opened', pull_request: pr('feat/x') }, demo), null)
})

test('a rejected AI review is routed to the task issue named in the PR body', () => {
  const notice = noticeFor(
    'issue_comment',
    {
      action: 'created',
      issue: { number: 5, pull_request: {}, body: '实现导出。\n\nCloses #2' },
      comment: { body: 'AI review (m): changes requested.\n\n- a.ts:1 - bug\n- b.ts:2 - risk', html_url: 'https://c' },
    },
    demo,
  )
  assert.deepEqual(notice, { to: { issue: 2 }, text: 'demo#2 审查打回：\n- a.ts:1 - bug\n- b.ts:2 - risk\nhttps://c' })
  const approved = {
    action: 'created',
    issue: { number: 5, pull_request: {}, body: 'Closes #2' },
    comment: { body: 'AI review (m): approved.', html_url: 'u' },
  }
  assert.equal(noticeFor('issue_comment', approved, demo), null)
})

test('an agent failure comment on the task issue notifies that issue', () => {
  const notice = noticeFor(
    'issue_comment',
    {
      action: 'created',
      issue: { number: 2 },
      comment: { body: 'AutoFlow agent: failed.\n\n- checks did not pass', html_url: 'u' },
    },
    demo,
  )
  assert.deepEqual(notice, { to: { issue: 2 }, text: 'demo#2 开发失败：\n- checks did not pass\nu' })
})

test('only announced workflows broadcast, and only on success', () => {
  const run = (name: string, conclusion: string) => ({
    action: 'completed',
    workflow_run: { name, conclusion, html_url: 'u' },
  })
  assert.deepEqual(noticeFor('workflow_run', run('Release', 'success'), demo), {
    to: 'all',
    text: 'demo「Release」完成\nu',
  })
  assert.equal(noticeFor('workflow_run', run('Release', 'failure'), demo), null)
  assert.equal(noticeFor('workflow_run', run('CI', 'success'), demo), null)
})

const SECRET = 'w'.repeat(32)
const delivery = async (body: unknown, signWith = SECRET, event = 'pull_request') => {
  const raw = JSON.stringify(body)
  return new Request('https://w/hook/github', {
    method: 'POST',
    headers: { 'x-github-event': event, 'x-hub-signature-256': `sha256=${await hmacHex(signWith, raw)}` },
    body: raw,
  })
}
const opened = { action: 'opened', repository: repo, pull_request: { head: { ref: 'agent/issue-2' }, html_url: 'u' } }

test('the webhook rejects a bad signature and ignores unknown repositories', async () => {
  const hook = new GitHubHook(SECRET, new Map([['demo', demo]]))
  assert.equal((await hook.receive(await delivery(opened, 'x'.repeat(32)))).kind, 'rejected')
  assert.equal(
    (await hook.receive(await delivery({ ...opened, repository: { full_name: 'evil/repo' } }))).kind,
    'ignored',
  )
  assert.equal((await hook.receive(await delivery(opened))).kind, 'notice')
})

test('notices go to the chat that asked, broadcasts to every bound chat', async () => {
  const kv = new MemoryKv()
  const conversations = new ConversationStore(kv)
  const connections = new ConnectionStore(kv, new Sealer('s'.repeat(32)))
  await connections.saveTelegram({ botToken: '1:a', botUsername: 'b', webhookSecret: 'h', userIds: [42, 43] })
  await conversations.linkIssue('o/demo', 2, { channel: 'telegram', chatId: '42' })
  const sent: string[] = []
  const chat: ChatSender = { name: 'telegram', send: async (chatId, text) => void sent.push(`${chatId}:${text}`) }
  const notifier = new Notifier({
    conversations,
    connections,
    senders: async (channel: ChannelName) => (channel === 'telegram' ? chat : null),
    log: new JsonLogger({ sink: () => {} }),
  })
  await notifier.deliver('o/demo', { to: { issue: 2 }, text: 'pr' })
  await notifier.deliver('o/demo', { to: { issue: 9 }, text: 'unknown issue' })
  await notifier.deliver('o/demo', { to: 'all', text: 'release' })
  assert.deepEqual(sent, ['42:pr', '42:release', '43:release'])
})
