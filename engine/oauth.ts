// The providers (2026-11-20): Google and LINE (OAuth 2.0 / OpenID Connect, authorization code with PKCE) and the one-time email link (Resend). Each one turns on BY ITSELF when its keys exist:
// the key is read the way the mailer's is — the environment variable of the same name wins, otherwise Secret Manager (latest version) with the Cloud Run service account — and a missing one is looked for
// again every minute, so a provider the owner has just finished setting up appears without a deploy. Until then its button is hidden and nothing else changes.
//
//   Google  ICHIREI_GOOGLE_CLIENT_ID, ICHIREI_GOOGLE_CLIENT_SECRET     redirect https://<host>/auth/google/callback          scope: openid email
//   LINE    ICHIREI_LINE_CHANNEL_ID,  ICHIREI_LINE_CHANNEL_SECRET      redirect https://<host>/auth/line/callback            scope: profile openid email
//   email   RESEND_API_KEY (engine/mailer.ts)
//
// We ask for nothing but the provider's id, the email when it gives one and, for LINE, the display name for the header. No profile photo, no friends list, no other permissions.
// Nothing here logs a token, a code, an email or a name. The network is injectable (tests mock the exchanges; no test calls a real provider).

import { createHash } from 'node:crypto'
import { publicUrl } from './animation.ts'
import { resolveMailer, type Mailer } from './mailer.ts'

export interface Keys {
  id: string
  secret: string
}
export type Providers = { google: Keys | null; line: Keys | null; email: Mailer | null }

const NAMES = {
  google: ['ICHIREI_GOOGLE_CLIENT_ID', 'ICHIREI_GOOGLE_CLIENT_SECRET'],
  line: ['ICHIREI_LINE_CHANNEL_ID', 'ICHIREI_LINE_CHANNEL_SECRET'],
} as const

const cache = new Map<string, { value: string | null; at: number }>()
const FOUND_MS = 10 * 60_000
const MISSING_MS = 60_000
async function secret(name: string, env: NodeJS.ProcessEnv, now: number, fetchImpl: typeof fetch): Promise<string | null> {
  const direct = env[name]?.trim()
  if (direct) return direct
  if (!env.K_SERVICE) return null // not on Cloud Run: no Secret Manager to ask
  const hit = cache.get(name)
  if (hit && now - hit.at < (hit.value ? FOUND_MS : MISSING_MS)) return hit.value
  let value: string | null = null
  try {
    const { readSecret } = await import('./track.ts')
    value = (await readSecret(name, {} as NodeJS.ProcessEnv, fetchImpl)) || null
  } catch {
    value = null
  }
  cache.set(name, { value, at: now })
  return value
}
export const resetProviderCache = (): void => cache.clear()

/** Which providers are on right now (a provider needs ALL of its keys). */
export async function providersOf(env: NodeJS.ProcessEnv = process.env, now: number = Date.now(), fetchImpl: typeof fetch = fetch): Promise<Providers> {
  const pair = async (k: keyof typeof NAMES): Promise<Keys | null> => {
    const [id, sec] = await Promise.all(NAMES[k].map((n) => secret(n, env, now, fetchImpl)))
    return id && sec ? { id, secret: sec } : null
  }
  const [google, line, email] = await Promise.all([pair('google'), pair('line'), resolveMailer(env, now, fetchImpl).catch(() => null)])
  return { google, line, email }
}
/** Sign-in is the precondition of the free trial — but only once at least one way in exists (until then nobody is turned away). */
export const signInRequired = (p: Providers): boolean => !!(p.google || p.line || p.email)

export const redirectUri = (provider: 'google' | 'line', env: NodeJS.ProcessEnv = process.env): string => `${publicUrl(env)}/auth/${provider}/callback`

const b64url = (b: Buffer): string => b.toString('base64url')
export const challengeOf = (verifier: string): string => b64url(createHash('sha256').update(verifier).digest())

/** The address that sends the person to the provider. */
export function authorizeUrl(provider: 'google' | 'line', keys: Keys, p: { state: string; nonce: string; verifier: string; lang: string }, env: NodeJS.ProcessEnv = process.env): string {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: keys.id,
    redirect_uri: redirectUri(provider, env),
    state: p.state,
    nonce: p.nonce,
    code_challenge: challengeOf(p.verifier),
    code_challenge_method: 'S256',
    scope: provider === 'google' ? 'openid email' : 'profile openid email',
  })
  if (provider === 'google') {
    q.set('prompt', 'select_account')
    return `https://accounts.google.com/o/oauth2/v2/auth?${q}`
  }
  if (p.lang === 'ja' || p.lang === 'en' || p.lang === 'zh-Hant') q.set('ui_locales', p.lang === 'zh-Hant' ? 'zh-TW' : p.lang)
  return `https://access.line.me/oauth2/v2.1/authorize?${q}`
}

export interface Proven {
  sub: string
  email: string | null
  emailVerified: boolean
  name: string | null
}

const form = (o: Record<string, string>): URLSearchParams => new URLSearchParams(o)
const claimsOf = (jwt: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * The code a provider sent back, exchanged for who the person is. Google: the id token comes straight from Google's token endpoint over TLS; its issuer, audience, expiry and nonce are checked.
 * LINE: the id token is verified by LINE's own verify endpoint (client id and nonce). A failure of any kind is null — the caller says "could not sign in" and nothing more.
 */
export async function exchangeCode(provider: 'google' | 'line', keys: Keys, p: { code: string; verifier: string; nonce: string }, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch, now: number = Date.now()): Promise<Proven | null> {
  try {
    const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://api.line.me/oauth2/v2.1/token'
    const tr = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form({ grant_type: 'authorization_code', code: p.code, redirect_uri: redirectUri(provider, env), client_id: keys.id, client_secret: keys.secret, code_verifier: p.verifier }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!tr.ok) return null
    const idToken = ((await tr.json()) as { id_token?: string }).id_token
    if (!idToken) return null
    if (provider === 'google') {
      const c = claimsOf(idToken)
      if (!c) return null
      const aud = c.aud
      if (!(c.iss === 'https://accounts.google.com' || c.iss === 'accounts.google.com') || !(aud === keys.id || (Array.isArray(aud) && aud.includes(keys.id)))) return null
      if (typeof c.exp !== 'number' || c.exp * 1000 <= now || c.nonce !== p.nonce || typeof c.sub !== 'string') return null
      return { sub: c.sub, email: typeof c.email === 'string' ? c.email : null, emailVerified: c.email_verified === true || c.email_verified === 'true', name: null }
    }
    const vr = await fetchImpl('https://api.line.me/oauth2/v2.1/verify', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: form({ id_token: idToken, client_id: keys.id, nonce: p.nonce }), signal: AbortSignal.timeout(12_000) })
    if (!vr.ok) return null
    const c = (await vr.json()) as { sub?: string; name?: string; email?: string; aud?: string; nonce?: string }
    if (typeof c.sub !== 'string' || (c.aud && c.aud !== keys.id) || (c.nonce && c.nonce !== p.nonce)) return null
    // LINE says the email is its user's own (the email permission); it is used as verified
    return { sub: c.sub, email: typeof c.email === 'string' && c.email ? c.email : null, emailVerified: true, name: typeof c.name === 'string' ? c.name.slice(0, 60) : null }
  } catch {
    return null
  }
}
