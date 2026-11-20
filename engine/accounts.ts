// Sign-in and the one account (2026-11-20). Sign-in is the precondition of the free trial and the single way to keep and find gifts, from any device.
//
//   accounts/<AC-…>.json                  the account: its id, the customer record it owns, the verified email (when the provider gives one), the LINE display name (for the header) and
//                                         each provider's id linked to it — nothing else: no photo, no friends, no other permissions
//   accounts/idx/<provider>-<hash>.json   provider id (or verified email) → account, so a returning person finds theirs; the hash is of the id, never the id itself
//   sessions/<hash>.json                  one session: { account, expires } — the cookie holds a random secret, the store holds only its hash
//   signin/state/<hash>.json              a sign-in in progress (OAuth state, nonce, PKCE verifier, where to go back to): 10 minutes
//   signin/mail/<hash>.json               a one-time email link: 15 minutes, single use
//
// ONE ACCOUNT: the same verified email from Google and from the email link is the same account. A LINE account with no email is the LINE id; the customer adds an email once where one is needed
// (the free-gift hold, the checkout). The account's customer record is the email's record when the email is known (so orders and holds under that email are already theirs) or an id of its own.
// At the first sign-in, whatever this browser saved or held before joins the account (engine/customer.ts joinCustomer).

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { casJson, emailCustomerId, joinCustomer, mergeCustomer, normalizeEmail, validEmail } from './customer.ts'
import type { OrderStore } from './order-store.ts'
import { key as signKey } from './rounds.ts'
import { cookieValue } from './visitor.ts'

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
export const SESSION_COOKIE = 'ic_s'
export const SESSION_DAYS = 180
export const MAIL_LINK_MINUTES = 15
export const STATE_MINUTES = 10

export type Provider = 'google' | 'line' | 'email'

export interface Account {
  schema: 'account'
  id: string
  /** The customer record this account owns (engine/customer.ts). */
  customer: string
  /** The verified email (when a provider gave one) — or the one the customer typed for a hold / checkout (`email_verified` false). */
  email: string | null
  email_verified: boolean
  /** LINE only: the display name for the header (no other profile data). */
  name: string | null
  providers: { google?: string; line?: string; email?: boolean }
  created_at: string
  last_login: string
}

export const ACCOUNT_PATTERN = /^AC-[a-z2-9]{20}$/
const sha = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 32)
const idxPath = (kind: Provider, id: string): string => `accounts/idx/${kind}-${sha(`${kind}|${id}`)}.json`
const accountPath = (id: string): string => `accounts/${id}.json`
const sessionPath = (secret: string): string => `sessions/${sha(`session|${secret}`)}.json`
const statePath = (s: string): string => `signin/state/${sha(`state|${s}`)}.json`
const mailPath = (t: string): string => `signin/mail/${sha(`mail|${t}`)}.json`

export const newAccountId = (random: (n: number) => Uint8Array = randomBytes): string => {
  let out = 'AC-'
  for (const b of random(20)) out += ALPHABET[b % ALPHABET.length]
  return out
}
/** The customer record of an account that has no email yet: an id of its own (E + 32 hex, the shape every customer id has). */
export const accountCustomerId = (accountId: string): string => `E${sha(`account|${accountId}`)}`

const jsonOf = <T>(raw: Buffer | null): T | null => {
  try {
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null
  } catch {
    return null
  }
}
export async function readAccount(store: OrderStore, id: string): Promise<Account | null> {
  if (!ACCOUNT_PATTERN.test(id)) return null
  const a = jsonOf<Account>(await store.getObject(accountPath(id)).catch(() => null))
  return a && a.schema === 'account' ? a : null
}

export interface Identity {
  provider: Provider
  /** The provider's id for the person (Google `sub`, LINE `sub`/userId); for the email link, the email itself. */
  sub: string
  email?: string | null
  emailVerified?: boolean
  name?: string | null
}

/**
 * The account of a person who has just proved who they are: an existing one (by provider id, else by the same verified email) or a new one. Returns whether it is new.
 */
export async function findOrCreateAccount(store: OrderStore, id: Identity, now: Date = new Date(), random?: (n: number) => Uint8Array): Promise<{ account: Account; created: boolean }> {
  const email = id.email && validEmail(id.email) && id.emailVerified !== false ? normalizeEmail(id.email) : null
  const sub = id.provider === 'email' ? normalizeEmail(id.sub) : id.sub
  // 1 · the same provider id
  let accountId = jsonOf<{ account?: string }>(await store.getObject(idxPath(id.provider, sub)).catch(() => null))?.account ?? null
  // 2 · the same verified email (Google and the email link are one account)
  if (!accountId && email) accountId = jsonOf<{ account?: string }>(await store.getObject(idxPath('email', email)).catch(() => null))?.account ?? null
  let created = false
  let account = accountId ? await readAccount(store, accountId) : null
  if (!account) {
    created = true
    const aid = newAccountId(random)
    account = { schema: 'account', id: aid, customer: email ? emailCustomerId(email) : accountCustomerId(aid), email, email_verified: !!email, name: id.name ?? null, providers: {}, created_at: now.toISOString(), last_login: now.toISOString() }
  }
  // attach this provider, the email and the display name; keep the indexes
  const next: Account = { ...account, providers: { ...account.providers }, last_login: now.toISOString() }
  if (id.provider === 'google') next.providers.google = sub
  else if (id.provider === 'line') { next.providers.line = sub; if (id.name) next.name = id.name.slice(0, 60) }
  else next.providers.email = true
  if (email && !next.email) {
    next.email = email
    next.email_verified = true
    const from = next.customer
    next.customer = emailCustomerId(email)
    if (from !== next.customer) await mergeCustomer(store, from, next.customer, now)
  } else if (email && next.email === email && !next.email_verified) next.email_verified = true
  await store.putObject(accountPath(next.id), JSON.stringify(next), 'application/json')
  await store.putObject(idxPath(id.provider, sub), JSON.stringify({ account: next.id }), 'application/json')
  if (next.email) await store.putObject(idxPath('email', next.email), JSON.stringify({ account: next.id }), 'application/json')
  return { account: next, created }
}

/** An account with no email gets one (the free-gift hold or the checkout asks once). It is the customer's own word until a link in a mail proves it. */
export async function addAccountEmail(store: OrderStore, account: Account, emailIn: string, now: Date = new Date()): Promise<Account | null> {
  if (!validEmail(emailIn)) return null
  const email = normalizeEmail(emailIn)
  if (account.email) return account
  const owner = jsonOf<{ account?: string }>(await store.getObject(idxPath('email', email)).catch(() => null))?.account
  if (owner && owner !== account.id) return null // that address belongs to another account: it has to be proved by signing in with it
  const from = account.customer
  const next: Account = { ...account, email, email_verified: false, customer: emailCustomerId(email) }
  if (from !== next.customer) await mergeCustomer(store, from, next.customer, now)
  await store.putObject(accountPath(next.id), JSON.stringify(next), 'application/json')
  await store.putObject(idxPath('email', email), JSON.stringify({ account: next.id }), 'application/json')
  return next
}

// ---- sessions --------------------------------------------------------------------------------------------------------------------------------------------------------------
const mac = (secret: string, env: NodeJS.ProcessEnv): string => createHmac('sha256', signKey(env)).update(`ic_s|${secret}`).digest('base64url').slice(0, 22)
export const sessionSetCookie = (value: string, maxAgeDays = SESSION_DAYS): string => `${SESSION_COOKIE}=${value}; Max-Age=${Math.round(maxAgeDays * 86_400)}; Path=/; HttpOnly; Secure; SameSite=Lax`
export const sessionClearCookie = (): string => `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`

/** A new session for the account: the cookie value `<secret>.<signature>`; the store keeps only a hash of the secret. */
export async function createSession(store: OrderStore, accountId: string, env: NodeJS.ProcessEnv = process.env, now: Date = new Date(), random: (n: number) => Uint8Array = randomBytes): Promise<string> {
  const secret = Buffer.from(random(24)).toString('base64url')
  await store.putObject(sessionPath(secret), JSON.stringify({ account: accountId, created: now.toISOString(), expires: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString() }), 'application/json')
  return `${secret}.${mac(secret, env)}`
}

/** The account of a request's session cookie (null: not signed in, forged, expired or ended). */
export async function sessionAccount(store: OrderStore | null, req: Request, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<Account | null> {
  if (!store) return null
  const v = cookieValue(req.headers.get('cookie'), SESSION_COOKIE)
  if (!v || v.length > 80) return null
  const [secret, sig, extra] = v.split('.')
  if (extra !== undefined || !secret || !sig || !/^[A-Za-z0-9_-]{20,40}$/.test(secret)) return null
  const want = Buffer.from(mac(secret, env))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const s = jsonOf<{ account?: string; expires?: string }>(await store.getObject(sessionPath(secret)).catch(() => null))
  if (!s?.account || !s.expires || Date.parse(s.expires) <= now.getTime()) return null
  return readAccount(store, s.account)
}

export async function endSession(store: OrderStore | null, req: Request): Promise<void> {
  const v = cookieValue(req.headers.get('cookie'), SESSION_COOKIE)
  const secret = v?.split('.')[0]
  if (store && secret && /^[A-Za-z0-9_-]{20,40}$/.test(secret)) await store.deleteObject?.(sessionPath(secret)).catch(() => {})
}

/** Sign this browser in as the account: a session, and the browser's own saves and holds join the account's record. Returns the cookie to set. */
export async function signIn(store: OrderStore, account: Account, browser: string | null, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<string> {
  if (browser) await joinCustomer(store, browser, account.customer, { email: account.email, openBasket: true }, now)
  return createSession(store, account.id, env, now)
}

// ---- a sign-in in progress (OAuth state) -----------------------------------------------------------------------------------------------------------------------------------
export interface SignInState {
  provider: Provider
  nonce: string
  verifier: string
  /** Where to go back to: a path of this site. */
  ret: string
  lang: string
  browser: string | null
  created: string
}
const rnd = (n: number): string => Buffer.from(randomBytes(n)).toString('base64url')
export async function newSignInState(store: OrderStore, p: { provider: Provider; ret: string; lang: string; browser: string | null }, now: Date = new Date()): Promise<{ state: string; nonce: string; verifier: string }> {
  const state = rnd(24), nonce = rnd(16), verifier = rnd(48)
  await store.putObject(statePath(state), JSON.stringify({ ...p, nonce, verifier, created: now.toISOString() } satisfies SignInState), 'application/json')
  return { state, nonce, verifier }
}
/** The sign-in a callback belongs to — used once. */
export async function takeSignInState(store: OrderStore, state: string, now: Date = new Date()): Promise<SignInState | null> {
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(state)) return null
  const s = jsonOf<SignInState>(await store.getObject(statePath(state)).catch(() => null))
  await store.deleteObject?.(statePath(state)).catch(() => {})
  return s && now.getTime() - Date.parse(s.created) < STATE_MINUTES * 60_000 ? s : null
}
/** A path of this site and nothing else (no scheme, no host, no `//`): where a sign-in returns to. */
export const safeReturn = (v: unknown, fallback = '/'): string => (typeof v === 'string' && /^\/(?!\/)[A-Za-z0-9\/_\-.~%?=&:+,]{0,300}$/.test(v) && !v.includes('..') ? v : fallback)

// ---- the one-time email link -----------------------------------------------------------------------------------------------------------------------------------------------------
export async function newMailLink(store: OrderStore, p: { email: string; lang: string; ret: string; browser: string | null }, now: Date = new Date()): Promise<string> {
  const t = rnd(32)
  await store.putObject(mailPath(t), JSON.stringify({ ...p, email: normalizeEmail(p.email), created: now.toISOString(), used: false }), 'application/json')
  return t
}
export type MailLink = { email: string; lang: string; ret: string; browser: string | null }
/** Look at a link without using it (the page that asks "continue?"). */
export async function peekMailLink(store: OrderStore, t: string, now: Date = new Date()): Promise<MailLink | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(t)) return null
  const r = jsonOf<MailLink & { created: string; used: boolean }>(await store.getObject(mailPath(t)).catch(() => null))
  return r && !r.used && now.getTime() - Date.parse(r.created) < MAIL_LINK_MINUTES * 60_000 ? r : null
}
/** Use a link: once. A second use, an expired or a made-up link gives null. */
export async function consumeMailLink(store: OrderStore, t: string, now: Date = new Date()): Promise<MailLink | null> {
  if (!/^[A-Za-z0-9_-]{30,60}$/.test(t)) return null
  let got: (MailLink & { created: string; used: boolean }) | null = null
  await casJson<MailLink & { created: string; used: boolean }>(store, mailPath(t), (cur) => {
    if (!cur || cur.used || now.getTime() - Date.parse(cur.created) >= MAIL_LINK_MINUTES * 60_000) return null
    got = cur
    return { ...cur, used: true }
  })
  return got
}

/** What the header may show: a masked email or the LINE name; never a full email. */
export function displayOf(a: Account): { kind: 'email' | 'line'; text: string } {
  const at = a.email ? a.email.lastIndexOf('@') : -1
  if (a.email && at > 0) return { kind: 'email', text: `${[...a.email.slice(0, at)][0]}•••${a.email.slice(at)}` }
  return { kind: 'line', text: a.name || 'LINE' }
}
