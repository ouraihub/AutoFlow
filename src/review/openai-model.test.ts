import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoFlowError } from '../core/errors.ts'
import { OpenAiCompatibleModel } from './openai-model.ts'

const model = (baseUrl: string, respond: () => Response) =>
  new OpenAiCompatibleModel({ baseUrl, apiKey: 'k', model: 'm', fetch: async () => respond() })

test('the base URL works with or without /v1', () => {
  assert.equal(model('https://relay.example', () => new Response()).url, 'https://relay.example/v1/chat/completions')
  assert.equal(
    model(' https://relay.example/v1/ ', () => new Response()).url,
    'https://relay.example/v1/chat/completions',
  )
})

test('returns the first choice content', async () => {
  const client = model('https://r', () => Response.json({ choices: [{ message: { content: 'hi' } }] }))
  assert.equal(await client.complete([]), 'hi')
})

test('an HTTP error becomes an upstream error carrying status and body', async () => {
  const client = model('https://r', () => new Response('<title>502: Bad gateway</title>', { status: 502 }))
  await assert.rejects(client.complete([]), (error: unknown) => {
    assert.ok(error instanceof AutoFlowError)
    assert.equal(error.code, 'upstream')
    assert.equal(error.context['status'], 502)
    assert.match(String(error.context['body']), /Bad gateway/)
    return true
  })
})

test('a response without message content is an upstream error', async () => {
  const client = model('https://r', () => Response.json({ choices: [] }))
  await assert.rejects(client.complete([]), { name: 'AutoFlowError', code: 'upstream' })
})
