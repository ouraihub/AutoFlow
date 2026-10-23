// Composition root of the Cloudflare Worker. Static assets (the /connect UI) are served by Workers
// Assets; this code only sees /api/* and /hook/* (run_worker_first) plus the cron trigger.
import { JsonLogger, type Logger } from '../core/log.ts'
import { AdminSession } from './admin-session.ts'
import { parseConfig, type Config } from './config.ts'
import { ConnectApi, TELEGRAM_HOOK_PATH } from './connect-api.ts'
import { ConnectionStore } from './connections.ts'
import { ConversationStore } from './conversations.ts'
import { Sealer } from './crypto.ts'
import { FeishuPoller } from './feishu-poller.ts'
import { FeishuClient, FeishuRegistration } from './feishu.ts'
import { GitHubIssues } from './github-issues.ts'
import { TaskRouter } from './router.ts'
import { TelegramHook } from './telegram-hook.ts'
import { TelegramClient } from './telegram.ts'

/** Secrets set with `wrangler secret put`; `wrangler types` only knows about vars and bindings. */
interface Secrets {
  GITHUB_TOKEN?: string
  SECRET_KEY?: string
  ADMIN_TOKEN?: string
}
type WorkerEnv = Env & Secrets

type App = { config: Config; connections: ConnectionStore; sealer: Sealer; log: Logger; env: WorkerEnv }

function app(env: WorkerEnv, log: Logger): App {
  const { AUTOFLOW: _kv, ASSETS: _assets, ...vars } = env
  const config = parseConfig(vars)
  const sealer = new Sealer(config.secretKey)
  return { config, sealer, log, env, connections: new ConnectionStore(env.AUTOFLOW, sealer) }
}

function router(app: App): TaskRouter {
  return new TaskRouter({
    issues: new GitHubIssues(app.config.githubToken),
    conversations: new ConversationStore(app.env.AUTOFLOW),
    config: app.config,
    log: app.log,
  })
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const log = new JsonLogger({ fields: { component: 'worker' } })
    let ready: App
    try {
      ready = app(env, log)
    } catch (error) {
      log.error('worker misconfigured', { error })
      return new Response('misconfigured', { status: 500 })
    }
    const path = new URL(request.url).pathname

    if (path.startsWith('/api/connect/')) {
      const api = new ConnectApi({
        session: new AdminSession(ready.config.adminToken, ready.config.secretKey),
        connections: ready.connections,
        registration: new FeishuRegistration(),
        poller: (client) => new FeishuPoller({ client, kv: env.AUTOFLOW, log }),
        sealer: ready.sealer,
        kv: env.AUTOFLOW,
        log,
        fetch,
      })
      return api.handle(request, path.slice('/api/connect'.length), Date.now())
    }

    if (path === TELEGRAM_HOOK_PATH && request.method === 'POST') {
      const result = await new TelegramHook({ connections: ready.connections, kv: env.AUTOFLOW, log }).receive(request)
      if (result.kind === 'rejected') return new Response('unauthorized', { status: 401 })
      if (result.kind === 'bound') {
        const client = new TelegramClient(result.connection.botToken)
        ctx.waitUntil(
          client
            .send(result.chatId, 'AutoFlow 已绑定。直接给我发需求，我会在 GitHub 上建任务；发 /help 查看用法。')
            .catch((error: unknown) => log.error('telegram reply failed', { error })),
        )
      }
      if (result.kind === 'message')
        ctx.waitUntil(router(ready).handle(new TelegramClient(result.connection.botToken), result.message))
      // Telegram retries anything but 2xx, so every verified update is acknowledged at once.
      return new Response('ok')
    }

    return new Response('not found', { status: 404 })
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    const log = new JsonLogger({ fields: { component: 'cron' } })
    try {
      const ready = app(env, log)
      const feishu = await ready.connections.feishu()
      if (!feishu) return
      const client = new FeishuClient(feishu, env.AUTOFLOW)
      const messages = await new FeishuPoller({ client, kv: env.AUTOFLOW, log }).poll(feishu, Date.now())
      const tasks = router(ready)
      // Sequential, so replies arrive in the order the messages were sent.
      ctx.waitUntil(
        (async () => {
          for (const message of messages) await tasks.handle(client, message)
        })(),
      )
    } catch (error) {
      log.error('feishu poll failed', { error })
    }
  },
} satisfies ExportedHandler<WorkerEnv>
