// The browser token (2026-11-15): no login, ever. The first visit gets a first-party cookie `ic_v` — a random id with an HMAC signature, signed with the same key as the round tickets
// (engine/rounds.ts: ICHIREI_ROUND_SECRET, else derived as before). It only tells one browser from another so the free tries can be counted per person instead of per connection
// (an office, a family or a mobile carrier shares one address). These limits are friction for casual overuse, not security: a missing or forged token is simply replaced by a new
// one and a request is NEVER refused only because the token is missing. HttpOnly, Secure, SameSite=Lax, one year.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { key } from './rounds.ts'

export const VISITOR_COOKIE = 'ic_v'
export const VISITOR_MAX_AGE = 365 * 86_400

const mac = (id: string, env: NodeJS.ProcessEnv): string => createHmac('sha256', key(env)).update(`ic_v|${id}`).digest('base64url').slice(0, 22)

export const newVisitorId = (random: (n: number) => Uint8Array = randomBytes): string => `V${Buffer.from(random(16)).toString('base64url')}`

/** `<id>.<signature>`, the cookie's value. */
export const visitorToken = (id: string, env: NodeJS.ProcessEnv = process.env): string => `${id}.${mac(id, env)}`

/** The id inside a token this server signed, else null (missing, malformed, forged). */
export function verifyVisitor(token: unknown, env: NodeJS.ProcessEnv = process.env): string | null {
  if (typeof token !== 'string' || token.length > 80) return null
  const [id, sig, extra] = token.split('.')
  if (extra !== undefined || !id || !sig || !/^V[A-Za-z0-9_-]{22}$/.test(id)) return null
  const want = Buffer.from(mac(id, env))
  const got = Buffer.from(sig)
  return want.length === got.length && timingSafeEqual(want, got) ? id : null
}

export const visitorSetCookie = (token: string): string => `${VISITOR_COOKIE}=${token}; Max-Age=${VISITOR_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`

/** One cookie's value out of a Cookie header. */
export function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** Tokens issued while a request is being served (the middleware gives a first-time visitor an id before the handler runs, so both see the same one). */
const issued = new WeakMap<Request, string>()

/** The person behind a request: the verified cookie, else the id issued to it a moment ago; null when there is none (a handler then counts by connection only). */
export function visitorOf(req: Request, env: NodeJS.ProcessEnv = process.env): string | null {
  return verifyVisitor(cookieValue(req.headers.get('cookie'), VISITOR_COOKIE), env) ?? issued.get(req) ?? null
}

/** Make sure this request has a person: returns the Set-Cookie line to send when the cookie was missing or forged, else null. Never refuses. */
export function ensureVisitor(req: Request, env: NodeJS.ProcessEnv = process.env): { id: string; setCookie: string | null } {
  const have = verifyVisitor(cookieValue(req.headers.get('cookie'), VISITOR_COOKIE), env)
  if (have) return { id: have, setCookie: null }
  const id = newVisitorId()
  issued.set(req, id)
  return { id, setCookie: visitorSetCookie(visitorToken(id, env)) }
}
