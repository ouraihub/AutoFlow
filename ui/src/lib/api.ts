/** Client for the Worker's /api/connect endpoints. Response shapes mirror src/worker/connect-api.ts. */

export type ConnectState = {
  feishu: { connected: boolean }
  telegram: { configured: boolean; username: string | null; boundUsers: number }
}
export type QrFlow = { id: string; url: string; expiresIn: number }
export type FlowStatus = { status: 'pending' } | { status: 'done' } | { status: 'failed'; message: string }

export class ApiError extends Error {
  override readonly name = 'ApiError'
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/connect${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? null : JSON.stringify(body),
    credentials: 'same-origin',
  })
  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      typeof data === 'object' && data !== null && 'error' in data && typeof data.error === 'string'
        ? data.error
        : '请求失败'
    throw new ApiError(response.status, message)
  }
  // The Worker is the only producer of these responses; shapes are defined together with it.
  return data as T
}

export const api = {
  state: () => call<ConnectState>('/state'),
  login: (token: string) => call<{ ok: true }>('/login', { token }),
  feishuBegin: () => call<QrFlow>('/feishu/begin', {}),
  feishuPoll: (id: string) => call<FlowStatus>('/feishu/poll', { id }),
  telegramToken: (token: string) => call<{ ok: true }>('/telegram/token', { token }),
  telegramBind: () => call<QrFlow>('/telegram/bind', {}),
  telegramPoll: (id: string) => call<FlowStatus>('/telegram/poll', { id }),
  disconnect: (channel: 'feishu' | 'telegram') => call<{ ok: true }>('/disconnect', { channel }),
}
