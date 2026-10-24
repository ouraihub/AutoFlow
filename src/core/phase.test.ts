import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decidePhase } from './phase.ts'

const footer = '\n\n---\n来源：telegram'
const comment = (text: string) => ({ event: 'issue_comment' as const, comment: `${text}${footer}` })

test('a new task always starts with the design, even if the first reply says 确认', () => {
  assert.equal(decidePhase({ event: 'issues', comment: '', hasDoc: false, approved: false }), 'design')
  assert.equal(decidePhase({ ...comment('确认'), hasDoc: false, approved: false }), 'design')
})

test('approving an existing design starts development', () => {
  for (const text of ['确认', '确认。', ' OK ', 'lgtm', '可以！', '开始开发']) {
    assert.equal(decidePhase({ ...comment(text), hasDoc: true, approved: false }), 'develop', text)
  }
})

test('feedback, questions and 继续 before approval keep designing', () => {
  for (const text of ['按钮放右边', '可以，但是按钮放右边', '确认一下数据库怎么改？', '继续']) {
    assert.equal(decidePhase({ ...comment(text), hasDoc: true, approved: false }), 'design', text)
  }
  assert.equal(decidePhase({ event: 'issues', comment: '', hasDoc: true, approved: false }), 'design')
})

test('after approval every run develops, including 继续 and feedback', () => {
  for (const text of ['继续', '按钮放右边']) {
    assert.equal(decidePhase({ ...comment(text), hasDoc: true, approved: true }), 'develop', text)
  }
})
