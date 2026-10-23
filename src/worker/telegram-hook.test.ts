import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JsonLogger } from '../core/log.ts'
import { ConnectionStore } from './connections.ts'
import { Sealer } from './crypto.ts'
import { MemoryKv } from './memory-kv.test-support.ts'
import { TelegramHook } from './telegram-hook.ts'

const silent = new JsonLogger({ sink: () => {} })

async function setup(userIds: number[] = []) {
  const kv = new MemoryKv()
  const connections = new ConnectionStore(kv, new Sealer('s'.repeat(32)))
  await connections.saveTelegram({ botToken: '1:abc', botUsername: 'af_bot', webhookSecret: 'hook-secret', userIds })
  return { kv, connections, hook: new TelegramHook({ connections, kv, log: silent }) }
}

const update = (text: string, userId = 42, secret = 'hook-secret') =>
  new Request('https://w/hook/telegram', {
    method: 'POST',
    headers: { 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ message: { text, from: { id: userId }, chat: { id: userId } } }),
  })

test('a wrong secret is rejected', async () => {
  const { hook } = await setup([42])
  assert.equal((await hook.receive(update('hi', 42, 'nope'))).kind, 'rejected')
})

test('/start with a pending code binds the sender once', async () => {
  const { kv, connections, hook } = await setup()
  await kv.put('telegram:bind:code1', 'pending')
  const result = await hook.receive(update('/start code1'))
  assert.equal(result.kind, 'bound')
  assert.deepEqual((await connections.telegram())?.userIds, [42])
  assert.equal(await kv.get('telegram:bind:code1'), 'done')
  // A used code cannot bind someone else.
  assert.equal((await hook.receive(update('/start code1', 7))).kind, 'ignored')
  assert.deepEqual((await connections.telegram())?.userIds, [42])
})

test('only bound users are routed; strangers are silently ignored', async () => {
  const { hook } = await setup([42])
  const routed = await hook.receive(update('加导出按钮'))
  assert.equal(routed.kind, 'message')
  assert.equal(routed.kind === 'message' ? routed.message.text : '', '加导出按钮')
  assert.equal((await hook.receive(update('加导出按钮', 7))).kind, 'ignored')
})

test('credentials are sealed in KV', async () => {
  const { kv } = await setup()
  const raw = await kv.get('connection:telegram')
  assert.ok(raw)
  assert.doesNotMatch(raw, /hook-secret|1:abc/)
})
