// Composition root for the agent's publish job. Runs after every develop run, including failed and
// timed-out ones, so committed progress is never lost: it pushes the run's commits to agent/issue-N,
// then reports on the issue (design ready / progress saved / failed) or opens the PR.
// Comments use GITHUB_TOKEN (they must not trigger the agent again); push and PR use AUTOFLOW_TOKEN
// (CI and review must run on them).
import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { AutoFlowError, requireEnv } from '../core/errors.ts'
import { JsonLogger } from '../core/log.ts'
import { parseProtectedPaths } from '../core/protected-paths.ts'
import { forbiddenChanges, progress } from './changes.ts'
import { DEVELOP_LABEL, type Phase } from '../core/phase.ts'

const run = promisify(execFile)
const env = process.env
const log = new JsonLogger({ fields: { component: 'agent-publish' } })
const SUMMARY_CHARS = 1500
const PUBLISHED = 'refs/autoflow/run'

async function git(...args: string[]): Promise<string> {
  return (await run('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })).stdout.trim()
}

async function gh(token: string, ...args: string[]): Promise<string> {
  const result = await run('gh', args, {
    encoding: 'utf8',
    env: { ...env, GH_TOKEN: token },
    maxBuffer: 16 * 1024 * 1024,
  })
  return result.stdout.trim()
}

const repo = requireEnv(env, 'GITHUB_REPOSITORY')
const number = requireEnv(env, 'ISSUE_NUMBER')
const runUrl = requireEnv(env, 'RUN_URL')
const botToken = requireEnv(env, 'BOT_TOKEN')

async function comment(
  marker: 'design ready' | 'paused' | 'updated' | 'failed',
  lines: readonly string[],
): Promise<void> {
  await gh(
    botToken,
    'issue',
    'comment',
    number,
    '-R',
    repo,
    '--body',
    [`AutoFlow agent: ${marker}.`, '', ...lines].join('\n'),
  )
}

try {
  const phaseValue = env['PHASE'] ?? ''
  const artifact = requireEnv(env, 'ARTIFACT_DIR')
  if (phaseValue !== 'design' && phaseValue !== 'develop') {
    // Prepare never decided a phase: configuration or the issue could not be read.
    await comment('failed', ['- 运行在开始前失败（配置或读取 issue 出错），没有产生任何改动。', `日志：${runUrl}`])
    process.exit(0)
  }
  const phase: Phase = phaseValue
  const docPath = requireEnv(env, 'DOC_PATH')
  const branch = `agent/issue-${number}`
  const base = requireEnv(env, 'BASE_SHA')
  const exitCode = env['EXIT_CODE'] ?? ''
  const summaryFile = join(artifact, 'summary.md')
  const summary = existsSync(summaryFile) ? readFileSync(summaryFile, 'utf8').trim().slice(0, SUMMARY_CHARS) : ''
  const bundle = join(artifact, 'agent.bundle')
  const completed = exitCode === '0'
  const reason = exitCode === '' ? '运行没有启动 omp' : `omp 退出码 ${exitCode}（超时、额度用完或出错）`

  if (!existsSync(bundle)) {
    if (phase === 'develop' && completed)
      await comment('paused', ['这次运行没有产生新的提交。', summary, `日志：${runUrl}`])
    else await comment('failed', [`- ${reason}，没有产生可保存的提交。`, `日志：${runUrl}`, '', '回复「继续」重试。'])
    process.exit(0)
  }

  await git('bundle', 'verify', bundle)
  await git('fetch', '--no-tags', bundle, `HEAD:${PUBLISHED}`)
  const files = (await git('diff', '--name-only', base, PUBLISHED)).split('\n').filter(Boolean)
  const protectedPaths = parseProtectedPaths(env['PROTECTED_PATHS'])
  const forbidden = forbiddenChanges(files, { phase, docPath, protectedPaths })
  if (forbidden.length > 0) {
    if (
      phase === 'design' &&
      files.includes(docPath) &&
      forbiddenChanges([docPath], { phase, docPath, protectedPaths }).length === 0
    ) {
      // The design document is the point of a design run: keep it, drop everything else.
      await git('-c', 'advice.detachedHead=false', 'checkout', '--quiet', base)
      await git('checkout', PUBLISHED, '--', docPath)
      await git(
        '-c',
        'user.name=autoflow-agent',
        '-c',
        'user.email=autoflow-agent@users.noreply.github.com',
        'commit',
        '--quiet',
        '-m',
        `docs: #${number} 设计文档（未包含越界改动）`,
      )
      await git('update-ref', PUBLISHED, 'HEAD')
      await comment('failed', [
        `- 设计阶段改了文档以外的文件，已丢弃：${forbidden.join('、')}`,
        '- 设计文档已单独保存。',
        `日志：${runUrl}`,
      ])
    } else {
      await comment('failed', [
        `- 这次运行改了不允许改的文件，提交没有推送：${forbidden.join('、')}`,
        phase === 'design' ? '- 设计阶段只能改设计文档。' : '- 这些路径受保护。',
        `日志：${runUrl}`,
        '',
        '回复「继续」重试。',
      ])
      process.exit(0)
    }
  }

  // Fast-forward only: base is the branch head the run started from, so a concurrent push is refused.
  await git('push', 'origin', `${PUBLISHED}:refs/heads/${branch}`)
  const commits = Number(await git('rev-list', '--count', `${base}..${PUBLISHED}`))
  const doc = await git('show', `${PUBLISHED}:${docPath}`).catch(() => '')
  const { done, total } = progress(doc)
  const server = requireEnv(env, 'SERVER_URL')
  const docUrl = `${server}/${repo}/blob/${branch}/${docPath}`
  const branchUrl = `${server}/${repo}/commits/${branch}`
  log.info('checkpoint pushed', { repo, issue: number, phase, commits, done, total, completed })

  if (phase === 'design') {
    if (completed) {
      await comment('design ready', [
        `设计文档：${docUrl}`,
        '',
        summary,
        '',
        '回复「确认」开始开发；回复修改意见会先改设计。',
      ])
    } else {
      await comment('paused', [
        `设计写到一半已保存（${commits} 个提交）：${docUrl}`,
        `- ${reason}`,
        '',
        '回复「继续」接着写。',
      ])
    }
    process.exit(0)
  }

  // Create the label on first use; an existing label makes `label create` fail, which is fine.
  await gh(
    botToken,
    'label',
    'create',
    DEVELOP_LABEL,
    '-R',
    repo,
    '--color',
    '1d76db',
    '--description',
    'AutoFlow: design approved, developing',
  ).catch(() => undefined)
  await gh(botToken, 'issue', 'edit', number, '-R', repo, '--add-label', DEVELOP_LABEL)
  const unfinished = total > 0 && done < total
  if (!completed || unfinished) {
    await comment('paused', [
      `已保存进度（任务 ${done}/${total}，${commits} 个提交）：${branchUrl}`,
      completed ? '- 任务清单还没做完。' : `- ${reason}`,
      summary,
      '',
      '回复「继续」从断点接着做。',
    ])
    process.exit(0)
  }

  const autoflowToken = requireEnv(env, 'AUTOFLOW_TOKEN')
  const existing = await gh(
    autoflowToken,
    'pr',
    'list',
    '-R',
    repo,
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'url',
    '--jq',
    '.[0].url',
  )
  if (existing) {
    await comment('updated', [`已更新 PR：${existing}`, '', summary])
  } else {
    const title = await gh(botToken, 'issue', 'view', number, '-R', repo, '--json', 'title', '--jq', '.title')
    await gh(
      autoflowToken,
      'pr',
      'create',
      '-R',
      repo,
      '--head',
      branch,
      '--title',
      title,
      '--body',
      [summary, '', `设计文档：${docUrl}`, '', `Closes #${number}`].join('\n'),
    )
  }
} catch (error) {
  log.error('agent publish failed', { error })
  // Best effort: the person must hear about it even if the failure was in the GitHub calls above.
  await comment('failed', [
    `- 保存或发布时出错：${error instanceof AutoFlowError ? error.message : '见日志'}`,
    `日志：${runUrl}`,
  ]).catch(() => undefined)
  process.exitCode = 1
}
