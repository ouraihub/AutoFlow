import { hmacHex, timingSafeEqual } from './crypto.ts'

const COOKIE = 'autoflow_admin'
const LIFETIME_SECONDS = 12 * 3600

/**
 * Login for the /connect page: ADMIN_TOKEN is exchanged for a signed, HttpOnly, SameSite=Strict cookie
 * `<expiry>.<hmac>`. State-changing requests must also come from the same origin.
 */
export class AdminSession {
  readonly #adminToken: string
  readonly #secret: string

  constructor(adminToken: string, secretKey: string) {
    this.#adminToken = adminToken
    this.#secret = secretKey
  }

  /** Returns the Set-Cookie value, or null when the token is wrong. */
  async login(token: string, nowMs: number): Promise<string | null> {
    if (!timingSafeEqual(token, this.#adminToken)) return null
    const expiry = Math.floor(nowMs / 1000) + LIFETIME_SECONDS
    const value = `${expiry}.${await hmacHex(this.#secret, `admin:${expiry}`)}`
    return `${COOKIE}=${value}; Path=/api/connect; HttpOnly; Secure; SameSite=Strict; Max-Age=${LIFETIME_SECONDS}`
  }

  async valid(request: Request, nowMs: number): Promise<boolean> {
    const cookie = request.headers.get('cookie') ?? ''
    const value = cookie
      .split(/;\s*/)
      .find((part) => part.startsWith(`${COOKIE}=`))
      ?.slice(COOKIE.length + 1)
    const [expiry, signature] = value?.split('.') ?? []
    if (!expiry || !signature || Number(expiry) * 1000 < nowMs) return false
    if (!timingSafeEqual(signature, await hmacHex(this.#secret, `admin:${expiry}`))) return false
    if (request.method === 'GET') return true
    // Cross-site POSTs carry no SameSite=Strict cookie, and the Origin check covers older clients.
    return request.headers.get('origin') === new URL(request.url).origin
  }
}
