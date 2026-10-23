import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatVerdict, parseVerdict } from './verdict.ts'

test('a verdict wrapped in prose or a code fence is accepted', () => {
  assert.deepEqual(parseVerdict('Result:\n```json\n{"verdict":"approve","issues":[]}\n```'), {
    verdict: 'approve',
    issues: [],
  })
})

test('an approval that lists issues becomes request_changes', () => {
  assert.deepEqual(parseVerdict('{"verdict":"approve","issues":["a.ts:1 - bug"]}'), {
    verdict: 'request_changes',
    issues: ['a.ts:1 - bug'],
  })
})

test('anything that is not a valid verdict fails closed', () => {
  for (const raw of [
    'Looks good, approve!',
    '{"verdict":"lgtm"}',
    '{"verdict":"approve",',
    '[]',
    'null',
    '{"verdict":true}',
  ]) {
    assert.equal(parseVerdict(raw), null, raw)
  }
})

test('non-string issues are dropped', () => {
  assert.deepEqual(parseVerdict('{"verdict":"request_changes","issues":["x",1,null]}'), {
    verdict: 'request_changes',
    issues: ['x'],
  })
})

test('the comment prefix stays stable for the chat bridge', () => {
  assert.equal(formatVerdict('m', { verdict: 'approve', issues: [] }), 'AI review (m): approved.')
  assert.equal(
    formatVerdict('m', { verdict: 'request_changes', issues: ['a'] }),
    'AI review (m): changes requested.\n\n- a',
  )
})
