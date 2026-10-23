import assert from 'node:assert/strict'
import { test } from 'node:test'
import { advanceCursor } from './feishu-poller.ts'

const message = (id: string, createdMs: number) => ({ id, createdMs, senderOpenId: 'ou_me', text: id })

test('messages in the cursor second that were already seen are not returned again', () => {
  const { fresh, cursor } = advanceCursor({ seconds: 100, seen: ['a'] }, [message('a', 100_200), message('b', 100_900)])
  assert.deepEqual(
    fresh.map((m) => m.id),
    ['b'],
  )
  assert.deepEqual(cursor, { seconds: 100, seen: ['a', 'b'] })
})

test('a later second moves the cursor and only remembers ids from that second', () => {
  const { fresh, cursor } = advanceCursor({ seconds: 100, seen: ['a'] }, [
    message('a', 100_200),
    message('c', 101_100),
    message('d', 101_800),
  ])
  assert.deepEqual(
    fresh.map((m) => m.id),
    ['c', 'd'],
  )
  assert.deepEqual(cursor, { seconds: 101, seen: ['c', 'd'] })
})

test('no messages leaves the cursor unchanged', () => {
  assert.deepEqual(advanceCursor({ seconds: 100, seen: ['a'] }, []), {
    fresh: [],
    cursor: { seconds: 100, seen: ['a'] },
  })
})
