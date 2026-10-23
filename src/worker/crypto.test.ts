import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Sealer, randomToken, timingSafeEqual } from './crypto.ts'

test('sealed values round-trip and differ every time', async () => {
  const sealer = new Sealer('k')
  const a = await sealer.seal('app-secret')
  const b = await sealer.seal('app-secret')
  assert.notEqual(a, b)
  assert.equal(await sealer.open(a), 'app-secret')
})

test('a different key or altered data cannot be opened', async () => {
  const sealed = await new Sealer('k').seal('app-secret')
  await assert.rejects(new Sealer('other').open(sealed))
  const tampered = `${sealed.slice(0, -4)}AAAA`
  await assert.rejects(new Sealer('k').open(tampered))
})

test('random tokens are URL-safe and unique', () => {
  const token = randomToken()
  assert.match(token, /^[A-Za-z0-9_-]{32}$/)
  assert.notEqual(token, randomToken())
})

test('timingSafeEqual compares content and length', () => {
  assert.equal(timingSafeEqual('secret', 'secret'), true)
  assert.equal(timingSafeEqual('secret', 'secreT'), false)
  assert.equal(timingSafeEqual('secret', 'secret2'), false)
})
