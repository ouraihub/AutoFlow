import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoFlowError } from '../core/errors.ts'
import { JsonLogger } from '../core/log.ts'
import { ConversationStore } from './conversations.ts'
import { MemoryKv } from './memory-kv.test-support.ts'
import type { ChatSender, CreatedIssue, IssueState, IssueTracker, TaskSnapshot } from './ports.ts'
import { TaskRouter } from './router.ts'

class FakeIssues implements IssueTracker {
  readonly created: { repo: string; title: string; labels: readonly string[] }[] = []
  readonly comments: { repo: string; number: number; body: string }[] = []
  fail = false
  readonly states = new Map<number, IssueState>()
  async issueState(_repo: string, number: number): Promise<IssueState> {
    return this.states.get(number) ?? 'open'
  }
  async createIssue(
    repo: string,
    issue: { title: string; body: string; labels: readonly string[] },
  ): Promise<CreatedIssue> {
    if (this.fail) throw new AutoFlowError('upstream', 'down')
    this.created.push({ repo, title: issue.title, labels: issue.labels })
    return { number: 7, url: `https://github.com/${repo}/issues/7` }
  }
  async comment(repo: string, number: number, body: string): Promise<{ url: string }> {
    this.comments.push({ repo, number, body })
    return { url: `https://github.com/${repo}/issues/${number}#c` }
  }
  readonly listed: { repo: string; label: string }[] = []
  async recentTasks(repo: string, label: string): Promise<TaskSnapshot[]> {
    this.listed.push({ repo, label })
    return [{ number: 4, title: '改文案', open: true, labels: ['agent'], comments: [] }]
  }
}

class FakeChat implements ChatSender {
  readonly name = 'telegram'
  readonly sent: string[] = []
  async send(_chatId: string, text: string): Promise<void> {
    this.sent.push(text)
  }
}

function setup() {
  const kv = new MemoryKv()
  const issues = new FakeIssues()
  const repos = new Map([
    ['demo', { alias: 'demo', repo: 'o/demo', announce: [] }],
    ['app', { alias: 'app', repo: 'o/app', announce: [] }],
  ])
  const router = new TaskRouter({
    issues,
    conversations: new ConversationStore(kv),
    config: { repos, defaultAlias: 'demo' },
    log: new JsonLogger({ sink: () => {} }),
  })
  return { kv, issues, router, chat: new FakeChat() }
}

const msg = (text: string) => ({ chatId: '1', text, replyTo: null })

test('a task becomes a labelled issue in the default repo and links the chat', async () => {
  const { kv, issues, router, chat } = setup()
  await router.handle(chat, msg('加一个导出按钮\n要支持 CSV'))
  assert.deepEqual(issues.created, [{ repo: 'o/demo', title: '加一个导出按钮', labels: ['agent'] }])
  assert.match(chat.sent[0] ?? '', /^收到需求 demo#7/)
  assert.match(chat.sent[0] ?? '', /#7 补充内容/)
  assert.ok(await kv.get('issue:o/demo#7'))
})

test('/use changes the chat default; @alias overrides it once', async () => {
  const { issues, router, chat } = setup()
  await router.handle(chat, msg('/use app'))
  await router.handle(chat, msg('修复登录'))
  await router.handle(chat, msg('@demo 改文案'))
  assert.deepEqual(
    issues.created.map((issue) => issue.repo),
    ['o/app', 'o/demo'],
  )
})

test('/status lists tasks of the chat default repo; /status <alias> picks another', async () => {
  const { issues, router, chat } = setup()
  await router.handle(chat, msg('/use app'))
  await router.handle(chat, msg('/status'))
  await router.handle(chat, msg('/status demo'))
  assert.deepEqual(issues.listed, [
    { repo: 'o/app', label: 'agent' },
    { repo: 'o/demo', label: 'agent' },
  ])
  assert.equal(chat.sent[1], 'app 的需求：\napp#4 设计中 · 改文案')
})

test('a follow-up comments on the issue', async () => {
  const { issues, router, chat } = setup()
  await router.handle(chat, msg('#12 还要深色模式'))
  assert.equal(issues.comments[0]?.number, 12)
  assert.match(chat.sent[0] ?? '', /^已补充到 demo#12/)
})

test('follow-ups to closed issues or non-issues are refused without commenting', async () => {
  const { issues, router, chat } = setup()
  issues.states.set(3, 'closed')
  issues.states.set(1, 'missing')
  await router.handle(chat, msg('#3 再加一句英文'))
  await router.handle(chat, msg('#1 补充'))
  assert.deepEqual(issues.comments, [])
  assert.match(chat.sent[0] ?? '', /demo#3 已经关闭/)
  assert.match(chat.sent[1] ?? '', /demo#1 不是一个需求/)
})

test('an unknown alias and a GitHub outage are reported in chat, not thrown', async () => {
  const { issues, router, chat } = setup()
  await router.handle(chat, msg('/use nope'))
  issues.fail = true
  await router.handle(chat, msg('任何需求'))
  assert.match(chat.sent[0] ?? '', /没有仓库别名 nope/)
  assert.match(chat.sent[1] ?? '', /GitHub 暂时不可用/)
})
