// Web Crypto only, so the same code runs in Workers and in Node tests.
const encoder = new TextEncoder()
const IV_BYTES = 12

/** Compares secrets without an early exit, so response time does not reveal the matching prefix. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let diff = left.length ^ right.length
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0)
  return diff === 0
}

/** Hex HMAC-SHA256, used to sign the admin session cookie. */
export async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data))
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** URL-safe random string with `bytes` bytes of entropy. */
export function randomToken(bytes = 24): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/**
 * AES-GCM with a key derived from the Worker secret SECRET_KEY. Channel credentials obtained by scanning
 * are stored sealed, so reading KV alone does not reveal them. Output: base64(iv ‖ ciphertext).
 */
export class Sealer {
  readonly #key: Promise<CryptoKey>

  constructor(secret: string) {
    this.#key = crypto.subtle
      .digest('SHA-256', encoder.encode(secret))
      .then((raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']))
  }

  async seal(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await this.#key, encoder.encode(plain)),
    )
    const out = new Uint8Array(IV_BYTES + cipher.length)
    out.set(iv)
    out.set(cipher, IV_BYTES)
    return btoa(String.fromCharCode(...out))
  }

  /** Throws when the data was sealed with another key or altered. */
  async open(sealed: string): Promise<string> {
    const data = Uint8Array.from(atob(sealed), (char) => char.charCodeAt(0))
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, IV_BYTES) },
      await this.#key,
      data.slice(IV_BYTES),
    )
    return new TextDecoder().decode(plain)
  }
}
