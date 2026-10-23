// Composition root for the review workflow: reads env, wires adapters, maps the verdict to an exit code.
// Exit 0 = approved, 1 = changes requested or failure (the required check fails either way).
import { AutoFlowError, requireEnv } from '../core/errors.ts'
import { JsonLogger } from '../core/log.ts'
import { GhPullRequests } from './gh-pull-requests.ts'
import { OpenAiCompatibleModel } from './openai-model.ts'
import { Reviewer } from './reviewer.ts'

const env = process.env
const log = new JsonLogger({ fields: { component: 'review' } })

try {
  const repo = requireEnv(env, 'GITHUB_REPOSITORY')
  const number = Number(requireEnv(env, 'PR_NUMBER'))
  if (!Number.isInteger(number) || number <= 0)
    throw new AutoFlowError('config', 'PR_NUMBER must be a positive integer')
  const maxDiffChars = Number(env['MAX_DIFF_CHARS'] || 120_000)
  if (!Number.isInteger(maxDiffChars) || maxDiffChars <= 0)
    throw new AutoFlowError('config', 'MAX_DIFF_CHARS must be a positive integer')

  const reviewer = new Reviewer(
    {
      model: new OpenAiCompatibleModel({
        baseUrl: requireEnv(env, 'AI_BASE_URL'),
        apiKey: requireEnv(env, 'AI_API_KEY'),
        model: requireEnv(env, 'AI_MODEL'),
      }),
      host: new GhPullRequests(repo),
      log: log.child({ repo }),
    },
    {
      protectedPaths: (env['PROTECTED_PATHS'] || '.github/')
        .split(',')
        .map((prefix) => prefix.trim())
        .filter(Boolean),
      maxDiffChars,
    },
  )
  const { verdict } = await reviewer.review(number)
  process.exitCode = verdict === 'approve' ? 0 : 1
} catch (error) {
  log.error('review failed', { error })
  process.exitCode = 1
}
