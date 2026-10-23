import assert from 'node:assert/strict'
import { test } from 'node:test'
import { FeishuRegistration } from './feishu.ts'

const answering = (status: number, body: unknown) =>
  new FeishuRegistration(
    async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  )

test('a pending scan arrives as HTTP 400 and is still pending', async () => {
  // Shape observed from accounts.feishu.cn on 2026-10-23.
  const registration = answering(400, { error: 'authorization_pending', error_description: '', code: 20094 })
  assert.deepEqual(await registration.poll('dc'), { status: 'pending' })
})

test('a completed scan returns the app credentials and the scanner', async () => {
  const registration = answering(200, { client_id: 'cli_x', client_secret: 's', user_info: { open_id: 'ou_me' } })
  assert.deepEqual(await registration.poll('dc'), { status: 'done', appId: 'cli_x', appSecret: 's', openId: 'ou_me' })
})

test('denied and expired scans fail with a reason', async () => {
  assert.deepEqual(await answering(400, { error: 'access_denied' }).poll('dc'), { status: 'failed', reason: 'denied' })
  assert.deepEqual(await answering(400, { error: 'expired_token' }).poll('dc'), { status: 'failed', reason: 'expired' })
})

test('a server error is an upstream failure, not a verdict', async () => {
  await assert.rejects(answering(502, { error: 'bad gateway' }).poll('dc'), { name: 'AutoFlowError', code: 'upstream' })
})
