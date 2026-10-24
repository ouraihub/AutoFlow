import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TaskSnapshot } from './ports.ts'
import { formatStatus, taskStatus } from './status.ts'

const task = (over: Partial<TaskSnapshot>): TaskSnapshot => ({
  number: 7,
  title: '新增 farewell 函数',
  open: true,
  labels: ['agent'],
  comments: [],
  ...over,
})
const report = (marker: string, body = '') => `AutoFlow agent: ${marker}.\n\n${body}`

test('the latest agent report decides the stage, with task progress when paused', () => {
  assert.equal(taskStatus(task({})), '设计中')
  assert.equal(taskStatus(task({ comments: [report('design ready')] })), '设计完成，等你确认')
  assert.equal(
    taskStatus(
      task({ labels: ['agent', 'agent:develop'], comments: [report('paused', '已保存进度（任务 2/5，3 个提交）')] }),
    ),
    '已暂停 2/5，回复「继续」',
  )
  assert.equal(taskStatus(task({ comments: [report('design ready'), report('opened', '已开 PR：u')] })), 'PR 审查中')
  assert.equal(taskStatus(task({ comments: [report('failed')] })), '运行失败')
  assert.equal(taskStatus(task({ open: false, comments: [report('opened')] })), '已完成')
})

test('a reply after the last report means a run is queued or in progress', () => {
  const confirmed = task({ comments: [report('design ready'), '确认\n\n---\n来源：telegram'] })
  assert.equal(taskStatus(confirmed), '开发中')
  const revising = task({ comments: [report('design ready'), '按钮放右边'] })
  assert.equal(taskStatus(revising), '修改设计中')
  const developing = task({ labels: ['agent', 'agent:develop'], comments: [report('paused'), '继续'] })
  assert.equal(taskStatus(developing), '开发中')
})

test('the reply lists open tasks first and says when there are none', () => {
  const text = formatStatus('demo', [
    task({ number: 3, open: false }),
    task({ number: 9, title: '加深色模式', comments: [report('design ready')] }),
  ])
  assert.equal(
    text,
    ['demo 的需求：', 'demo#9 设计完成，等你确认 · 加深色模式', 'demo#3 已完成 · 新增 farewell 函数'].join('\n'),
  )
  assert.equal(formatStatus('demo', []), 'demo 还没有需求。')
})
