import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AdminSession } from './admin-session.ts'

const session = new AdminSession('a'.repeat(32), 'k'.repeat(32))
const NOW = 1_800_000_000_000
const ORIGIN = 'https://autoflow.example'

async function cookie(): Promise<string> {
  const set = await session.login('a'.repeat(32), NOW)
  assert.ok(set)
  return set.split(';')[0] ?? ''
}

test('a wrong admin token gets no session', async () => {
  assert.equal(await session.login('wrong', NOW), null)
})

test('the issued cookie is HttpOnly, Secure, SameSite=Strict', async () => {
  const set = (await session.login('a'.repeat(32), NOW)) ?? ''
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/api/connect;'])
    assert.match(set, new RegExp(flag))
})

test('a valid cookie opens GET and same-origin POST', async () => {
  const headers = { cookie: await cookie() }
  assert.equal(await session.valid(new Request(`${ORIGIN}/api/connect/state`, { headers }), NOW), true)
  const post = new Request(`${ORIGIN}/api/connect/disconnect`, {
    method: 'POST',
    headers: { ...headers, origin: ORIGIN },
  })
  assert.equal(await session.valid(post, NOW), true)
})

test('cross-origin POST, expired or forged cookies are refused', async () => {
  const value = await cookie()
  const cross = new Request(`${ORIGIN}/api/connect/disconnect`, {
    method: 'POST',
    headers: { cookie: value, origin: 'https://evil.example' },
  })
  assert.equal(await session.valid(cross, NOW), false)
  assert.equal(
    await session.valid(new Request(`${ORIGIN}/x`, { headers: { cookie: value } }), NOW + 13 * 3600 * 1000),
    false,
  )
  const forged = value.replace(/\.[0-9a-f]+$/, '.00')
  assert.equal(await session.valid(new Request(`${ORIGIN}/x`, { headers: { cookie: forged } }), NOW), false)
})
