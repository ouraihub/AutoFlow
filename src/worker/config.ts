import { AutoFlowError, requireEnv } from '../core/errors.ts'
import { isRecord } from '../core/guard.ts'

/** Repository alias as typed in chat, e.g. `demo` in `demo#12`. */
export const ALIAS_PATTERN = '[a-z0-9][a-z0-9_-]*'
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/
const MIN_SECRET_CHARS = 32

export type RepoTarget = { alias: string; repo: string; announce: readonly string[] }

/**
 * Deploy-time settings only. Telegram and Feishu credentials are not configured here: they are obtained
 * on the /connect page (Feishu by QR registration, Telegram by pasting the BotFather token once) and
 * stored sealed in KV.
 */
export type Config = {
  repos: ReadonlyMap<string, RepoTarget>
  defaultAlias: string
  githubToken: string
  /** Seals channel credentials in KV and signs admin sessions. */
  secretKey: string
  /** Password for the /connect page. */
  adminToken: string
  /** Shared with the repositories' webhooks; null keeps /hook/github closed. */
  githubWebhookSecret: string | null
}

type Vars = Readonly<Record<string, string | undefined>>

export function parseConfig(vars: Vars): Config {
  const repos = parseRepos(requireEnv(vars, 'REPOS'))
  const defaultAlias = requireEnv(vars, 'DEFAULT_REPO')
  if (!repos.has(defaultAlias))
    throw new AutoFlowError('config', `DEFAULT_REPO "${defaultAlias}" is not a key of REPOS`)
  const secretKey = requireEnv(vars, 'SECRET_KEY')
  const adminToken = requireEnv(vars, 'ADMIN_TOKEN')
  if (secretKey.length < MIN_SECRET_CHARS || adminToken.length < MIN_SECRET_CHARS) {
    throw new AutoFlowError('config', `SECRET_KEY and ADMIN_TOKEN need at least ${MIN_SECRET_CHARS} characters`)
  }
  const webhookSecret = vars['GITHUB_WEBHOOK_SECRET']?.trim() || null
  if (webhookSecret !== null && webhookSecret.length < MIN_SECRET_CHARS) {
    throw new AutoFlowError('config', `GITHUB_WEBHOOK_SECRET needs at least ${MIN_SECRET_CHARS} characters`)
  }
  return {
    repos,
    defaultAlias,
    githubToken: requireEnv(vars, 'GITHUB_TOKEN'),
    secretKey,
    adminToken,
    githubWebhookSecret: webhookSecret,
  }
}

function parseRepos(raw: string): Map<string, RepoTarget> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch (cause) {
    throw new AutoFlowError('config', 'REPOS is not valid JSON', { cause })
  }
  if (!isRecord(value)) throw new AutoFlowError('config', 'REPOS must be an object of alias → { repo }')
  const repos = new Map<string, RepoTarget>()
  const alias = new RegExp(`^${ALIAS_PATTERN}$`)
  for (const [name, entry] of Object.entries(value)) {
    const repo = isRecord(entry) ? entry['repo'] : undefined
    const announce = isRecord(entry) ? (entry['announce'] ?? []) : undefined
    if (!alias.test(name) || typeof repo !== 'string' || !REPO_PATTERN.test(repo)) {
      throw new AutoFlowError('config', `REPOS entry "${name}" needs a lowercase alias and repo "owner/name"`)
    }
    if (!Array.isArray(announce) || !announce.every((item) => typeof item === 'string')) {
      throw new AutoFlowError('config', `REPOS entry "${name}": announce must be a list of workflow names`)
    }
    repos.set(name, { alias: name, repo, announce })
  }
  if (repos.size === 0) throw new AutoFlowError('config', 'REPOS is empty')
  return repos
}
