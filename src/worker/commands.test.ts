import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCommand } from './commands.ts'

test('plain text is a task for the default repository', () => {
  assert.deepEqual(parseCommand('  加一个导出按钮\n要支持 CSV ', null), {
    kind: 'task',
    alias: null,
    text: '加一个导出按钮\n要支持 CSV',
  })
})

test('@alias targets a repository', () => {
  assert.deepEqual(parseCommand('@Demo 修复登录', null), { kind: 'task', alias: 'demo', text: '修复登录' })
})

test('#N and alias#N add to an issue', () => {
  assert.deepEqual(parseCommand('#12 还要深色模式', null), {
    kind: 'followup',
    alias: null,
    issue: 12,
    text: '还要深色模式',
  })
  assert.deepEqual(parseCommand('demo#3 补充', null), { kind: 'followup', alias: 'demo', issue: 3, text: '补充' })
})

test('replying to a bot message continues the issue it names', () => {
  const confirmation =
    '收到需求 demo#7\nhttps://github.com/o/r/issues/7\n要补充这个需求：回复本条消息，或发送「#7 补充内容」'
  assert.deepEqual(parseCommand('按钮放右边', confirmation), {
    kind: 'followup',
    alias: 'demo',
    issue: 7,
    text: '按钮放右边',
  })
})

test('slash commands, including the bot-suffixed form groups send', () => {
  assert.deepEqual(parseCommand('/help', null), { kind: 'help' })
  assert.deepEqual(parseCommand('/repos@autoflow_bot', null), { kind: 'repos' })
  assert.deepEqual(parseCommand('/use Demo', null), { kind: 'use', alias: 'demo' })
})

test('a bare #N without text is a task, and blank input is empty', () => {
  assert.deepEqual(parseCommand('#12', null), { kind: 'task', alias: null, text: '#12' })
  assert.deepEqual(parseCommand('   ', null), { kind: 'empty' })
})
