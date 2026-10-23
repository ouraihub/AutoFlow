import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseKeyPool } from './key-pool.ts'
import { parseProtectedPaths, touchedProtected } from './protected-paths.ts'

test('parses ordered entries, normalises /v1, skips blanks and comments', () => {
  const pool = parseKeyPool('# primary\nhttps://a.example sk-1\n\n  https://b.example/v1/  sk-2\r\n')
  assert.deepEqual(pool, [
    { baseUrl: 'https://a.example/v1', apiKey: 'sk-1' },
    { baseUrl: 'https://b.example/v1', apiKey: 'sk-2' },
  ])
})

test('a bad line is reported by number without echoing the secret', () => {
  for (const raw of ['https://a sk-1\nsk-only', 'http://insecure sk-1', 'https://a sk-1 extra']) {
    assert.throws(
      () => parseKeyPool(raw),
      (error: unknown) => error instanceof Error && /line \d/.test(error.message) && !/sk-/.test(error.message),
    )
  }
  assert.throws(() => parseKeyPool('\n# nothing\n'), /no entries/)
})

test('protected paths default to .github/ and match by prefix', () => {
  assert.deepEqual(parseProtectedPaths(undefined), ['.github/'])
  assert.deepEqual(parseProtectedPaths(' .github/, scripts/release '), ['.github/', 'scripts/release'])
  assert.deepEqual(touchedProtected(['.github/workflows/ci.yml', 'src/a.ts', '.githubx'], ['.github/']), [
    '.github/workflows/ci.yml',
  ])
})
