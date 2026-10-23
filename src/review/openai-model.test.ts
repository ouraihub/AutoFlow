import assert from 'node:assert/strict'
import { test } from 'node:test'
import { AutoFlowError } from '../core/errors.ts'
import { OpenAiCompatibleModel } from './openai-model.ts'

const keys = [
  { baseUrl: 'https://a.example/v1', apiKey: 'k1' },
  { baseUrl: 'https://b.example/v1', apiKey: 'k2' },
]
const ok = () => Response.json({ choices: [{ message: { content: 'hi' } }] })

/** Answers each request with the next response and records which key it carried. */
function scripted(...responses: (() => Response | Promise<Response>)[]) {
  const used: string[] = []
  const model = new OpenAiCompatibleModel({
    keys,
    model: 'm',
    fetch: async (input, init) => {
      used.push(`${String(input)} ${new Headers(init?.headers).get('authorization')}`)
      const next = responses.shift()
      if (!next) throw new Error('unexpected request')
      return next()
    },
  })
  return { model, used }
}

test('returns the first choice from the first key', async () => {
  const { model, used } = scripted(ok)
  assert.equal(await model.complete([]), 'hi')
  assert.deepEqual(used, ['https://a.example/v1/chat/completions Bearer k1'])
})

test('a refused key (401/403/429) moves to the next key', async () => {
  for (const status of [401, 403, 429]) {
    const { model, used } = scripted(() => new Response('quota', { status }), ok)
    assert.equal(await model.complete([]), 'hi', String(status))
    assert.equal(used[1], 'https://b.example/v1/chat/completions Bearer k2')
  }
})

test('when every key is refused the error says the pool is exhausted', async () => {
  const { model } = scripted(
    () => new Response('quota', { status: 429 }),
    () => new Response('额度已用完', { status: 403 }),
  )
  await assert.rejects(model.complete([]), (error: unknown) => {
    assert.ok(error instanceof AutoFlowError)
    assert.equal(error.context['poolExhausted'], true)
    assert.match(String(error.context['body']), /额度/)
    return true
  })
})

test('5xx and network failures do not try other keys', async () => {
  const fivexx = scripted(() => new Response('<title>502</title>', { status: 502 }))
  await assert.rejects(fivexx.model.complete([]), { name: 'AutoFlowError', code: 'upstream' })
  assert.equal(fivexx.used.length, 1)
  const network = scripted(() => Promise.reject(new TypeError('fetch failed')))
  await assert.rejects(network.model.complete([]), { name: 'AutoFlowError', code: 'upstream' })
  assert.equal(network.used.length, 1)
})

test('a response without message content is an upstream error', async () => {
  const { model } = scripted(() => Response.json({ choices: [] }))
  await assert.rejects(model.complete([]), { name: 'AutoFlowError', code: 'upstream' })
})
