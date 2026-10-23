// Composition root for the agent's develop job, before omp runs: reads the task issue and the design
// document on the branch, decides the phase, writes the omp config for the key pool and the prompt file,
// and exports the key variables masked. The issue text never passes through a shell.
import { execFile } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AutoFlowError, requireEnv } from '../core/errors.ts'
import { readPath } from '../core/guard.ts'
import { parseKeyPool } from '../core/key-pool.ts'
import { JsonLogger } from '../core/log.ts'
import { parseProtectedPaths } from '../core/protected-paths.ts'
import { ompSetup } from './omp-config.ts'
import { DEVELOP_LABEL, decidePhase } from './phase.ts'
import { agentPrompt, type TaskComment } from './prompt.ts'

const run = promisify(execFile)
const env = process.env
const log = new JsonLogger({ fields: { component: 'agent-prepare' } })

try {
  const repo = requireEnv(env, 'GITHUB_REPOSITORY')
  const number = Number(requireEnv(env, 'ISSUE_NUMBER'))
  if (!Number.isInteger(number) || number <= 0)
    throw new AutoFlowError('config', 'ISSUE_NUMBER must be a positive integer')
  const event = requireEnv(env, 'EVENT_NAME')
  if (event !== 'issues' && event !== 'issue_comment') throw new AutoFlowError('config', `unsupported event ${event}`)
  const workdir = requireEnv(env, 'WORKDIR')
  const agentDir = requireEnv(env, 'OMP_AGENT_DIR')
  const docPath = requireEnv(env, 'DOC_PATH_TEMPLATE').replace('{n}', String(number))
  if (docPath.startsWith('/') || docPath.split('/').includes('..')) {
    throw new AutoFlowError('config', 'doc_path must be a relative path inside the repository')
  }

  const { stdout } = await run(
    'gh',
    ['issue', 'view', String(number), '-R', repo, '--json', 'title,body,comments,labels'],
    {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    },
  )
  const issue: unknown = JSON.parse(stdout)
  const title = readPath(issue, ['title'])
  const body = readPath(issue, ['body'])
  const rawComments = readPath(issue, ['comments'])
  const rawLabels = readPath(issue, ['labels'])
  if (
    typeof title !== 'string' ||
    typeof body !== 'string' ||
    !Array.isArray(rawComments) ||
    !Array.isArray(rawLabels)
  ) {
    throw new AutoFlowError('upstream', 'gh issue view returned an unexpected shape', { context: { number } })
  }
  const comments = rawComments.flatMap((comment: unknown): TaskComment[] => {
    const author = readPath(comment, ['author', 'login'])
    const text = readPath(comment, ['body'])
    return typeof author === 'string' && typeof text === 'string' ? [{ author, body: text }] : []
  })
  const approved = rawLabels.some((label: unknown) => readPath(label, ['name']) === DEVELOP_LABEL)

  const docFile = join(workdir, docPath)
  const doc = existsSync(docFile) ? readFileSync(docFile, 'utf8') : null
  const phase = decidePhase({ event, comment: env['COMMENT_BODY'] ?? '', hasDoc: doc !== null, approved })

  const setup = ompSetup(parseKeyPool(requireEnv(env, 'AI_KEYS')), requireEnv(env, 'AI_MODEL'))
  mkdirSync(agentDir, { recursive: true })
  writeFileSync(join(agentDir, 'models.yml'), setup.models)
  writeFileSync(join(agentDir, 'config.yml'), setup.config)
  const githubEnv = requireEnv(env, 'GITHUB_ENV')
  for (const [name, value] of Object.entries(setup.env)) {
    // ::add-mask:: first, so the value is redacted from every later log line of the job.
    console.log(`::add-mask::${value}`)
    appendFileSync(githubEnv, `${name}=${value}\n`)
  }
  appendFileSync(githubEnv, `OMP_MODEL=${setup.model}\n`)

  const prompt = agentPrompt(
    { number, title, body, comments },
    {
      phase,
      owner: requireEnv(env, 'REPO_OWNER'),
      docPath,
      doc,
      checks: env['CHECKS'] ?? '',
      protectedPaths: parseProtectedPaths(env['PROTECTED_PATHS']),
    },
  )
  writeFileSync(requireEnv(env, 'PROMPT_FILE'), prompt)
  appendFileSync(requireEnv(env, 'GITHUB_OUTPUT'), `phase=${phase}\ndoc_path=${docPath}\n`)
  log.info('agent prepared', {
    repo,
    issue: number,
    phase,
    resumed: doc !== null,
    approved,
    keys: Object.keys(setup.env).length,
  })
} catch (error) {
  log.error('agent prepare failed', { error })
  process.exitCode = 1
}
