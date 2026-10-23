import type { KeyEntry } from '../core/key-pool.ts'

export type OmpSetup = {
  /** Contents of models.yml (JSON is valid YAML). */
  models: string
  /** Contents of config.yml. */
  config: string
  /** Environment for the omp process: one variable per key, referenced by name from models.yml. */
  env: Record<string, string>
  /** `--model` selector for the first relay. */
  model: string
}

/**
 * One omp provider per pool entry, all serving the same model id, chained so that a usage-limit
 * failure on relay-N continues on relay-N+1 with the same model. Keys never enter the files: models.yml
 * names environment variables.
 */
export function ompSetup(keys: readonly KeyEntry[], modelId: string): OmpSetup {
  const providers: Record<string, unknown> = {}
  const env: Record<string, string> = {}
  keys.forEach((key, index) => {
    const variable = `AUTOFLOW_KEY_${index + 1}`
    env[variable] = key.apiKey
    providers[`relay-${index + 1}`] = {
      baseUrl: key.baseUrl,
      apiKey: variable,
      authHeader: true,
      api: 'openai-completions',
      models: [{ id: modelId, name: `${modelId} (relay ${index + 1})` }],
    }
  })
  const fallbackChains =
    keys.length > 1 ? { 'relay-1/*': keys.slice(1).map((_key, index) => `relay-${index + 2}/*`) } : {}
  const config = {
    retry: { enabled: true, modelFallback: true, fallbackOn: 'usage-limit', fallbackChains },
  }
  return {
    models: JSON.stringify({ providers }, null, 2),
    config: JSON.stringify(config, null, 2),
    env,
    model: `relay-1/${modelId}`,
  }
}
