import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoFlowError } from './errors.ts'
import { readPath } from './guard.ts'
import { JsonLogger, type LogLevel } from './log.ts'

const capture = (level?: LogLevel) => {
  const lines: unknown[] = []
  const log = new JsonLogger({ ...(level ? { level } : {}), sink: (_level, line) => lines.push(JSON.parse(line)) })
  return { log, lines }
}

test('child fields are merged and errors are expanded with code, context and cause', () => {
  const { log, lines } = capture()
  const error = new AutoFlowError('upstream', 'relay down', { cause: new Error('socket'), context: { status: 502 } })
  log.child({ repo: 'o/r' }).error('review failed', { error })
  assert.equal(lines.length, 1)
  const event = lines[0]
  assert.equal(readPath(event, ['repo']), 'o/r')
  assert.equal(readPath(event, ['error', 'code']), 'upstream')
  assert.deepEqual(readPath(event, ['error', 'context']), { status: 502 })
  assert.equal(readPath(event, ['error', 'cause', 'message']), 'socket')
})

test('events below the minimum level are dropped', () => {
  const { log, lines } = capture('warn')
  log.info('ignored')
  log.warn('kept')
  assert.deepEqual(
    lines.map((line) => readPath(line, ['msg'])),
    ['kept'],
  )
})
