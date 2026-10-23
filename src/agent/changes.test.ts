import assert from 'node:assert/strict'
import { test } from 'node:test'
import { forbiddenChanges, progress } from './changes.ts'

const rules = { docPath: 'docs/issue-2.md', protectedPaths: ['.github/'] }

test('a design run may only change its design document', () => {
  assert.deepEqual(forbiddenChanges(['docs/issue-2.md'], { ...rules, phase: 'design' }), [])
  assert.deepEqual(forbiddenChanges(['docs/issue-2.md', 'src/a.ts'], { ...rules, phase: 'design' }), ['src/a.ts'])
})

test('a develop run may change code and the doc, never protected paths', () => {
  assert.deepEqual(forbiddenChanges(['src/a.ts', 'docs/issue-2.md'], { ...rules, phase: 'develop' }), [])
  assert.deepEqual(forbiddenChanges(['src/a.ts', '.github/workflows/ci.yml'], { ...rules, phase: 'develop' }), [
    '.github/workflows/ci.yml',
  ])
})

test('progress counts checked and open checklist items', () => {
  const doc = '## 任务\n- [x] 读代码\n- [X] 写测试\n- [ ] 实现\n  * [ ] 文档\n\n普通 - [ ] 不算'
  assert.deepEqual(progress(doc), { done: 2, total: 4 })
  assert.deepEqual(progress('没有清单'), { done: 0, total: 0 })
})
