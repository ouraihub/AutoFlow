import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ompSetup } from './omp-config.ts'

const pool = [
  { baseUrl: 'https://a.example/v1', apiKey: 'sk-1' },
  { baseUrl: 'https://b.example/v1', apiKey: 'sk-2' },
  { baseUrl: 'https://c.example/v1', apiKey: 'sk-3' },
]

test('each key becomes a provider chained on usage limits, keys only in env', () => {
  const setup = ompSetup(pool, 'gpt-6.1-sol')
  const models: unknown = JSON.parse(setup.models)
  const config: unknown = JSON.parse(setup.config)
  assert.equal(setup.model, 'relay-1/gpt-6.1-sol')
  assert.deepEqual(setup.env, { AUTOFLOW_KEY_1: 'sk-1', AUTOFLOW_KEY_2: 'sk-2', AUTOFLOW_KEY_3: 'sk-3' })
  assert.deepEqual(models, {
    providers: Object.fromEntries(
      pool.map((key, i) => [
        `relay-${i + 1}`,
        {
          baseUrl: key.baseUrl,
          apiKey: `AUTOFLOW_KEY_${i + 1}`,
          authHeader: true,
          api: 'openai-completions',
          models: [{ id: 'gpt-6.1-sol', name: `gpt-6.1-sol (relay ${i + 1})` }],
        },
      ]),
    ),
  })
  assert.deepEqual(config, {
    retry: {
      enabled: true,
      modelFallback: true,
      fallbackOn: 'usage-limit',
      fallbackChains: { 'relay-1/*': ['relay-2/*', 'relay-3/*'] },
    },
  })
  assert.doesNotMatch(setup.models + setup.config, /sk-\d/)
})

test('a single key has no fallback chain', () => {
  const config: unknown = JSON.parse(ompSetup(pool.slice(0, 1), 'm').config)
  assert.deepEqual(config, {
    retry: { enabled: true, modelFallback: true, fallbackOn: 'usage-limit', fallbackChains: {} },
  })
})
