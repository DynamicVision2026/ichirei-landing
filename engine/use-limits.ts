// Free-use limits that hold (Ticket 4 Part 19, 2026-11-20). One rule, in one sentence: a person may write 3 new moments a day (+3 for every gift they give that day), and at most 10
// moments that were never given in any 30 days (giving one sets that back to 0). Every count lives IN THE STORE — shared by every server copy and kept across deploys — and one person is
// every key we know them by: the account (when signed in), each email, the browser token and, as the backstop, the connection. WHICHEVER COUNT IS HIGHEST applies, so clearing cookies or
// switching browser resets nothing while the email or the connection is the same.
//
//   limits/day/<JST day>/<key hash>.json   { n: moments today, bonus: +N earned today, pics: picture sets drawn today }
//   limits/unsent/<key hash>.json          { stamps: [ISO of each moment not yet given, last 30 days], reset_at }
//   ops/limits-<JST day>.jsonl             one line per new moment / picture set for the dashboard: { ts, p: short hash, label (masked), kind }  — never a full email or address
//
// Keys are hashed before they touch the store (an email, a cookie id or an address is never written in the clear). A limit is friction for casual overuse, never a block on paying or on
// the gift back: only /api/select (new moments) and the card preview's pictures use it. The owner's own browsers are exempt through a private cookie set from /ops.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { analyticsDay } from './analytics.ts'
import { casJson, customerIdOf, readCustomer } from './customer.ts'
import { clientIp } from './rate-limit.ts'
import type { OrderStore } from './order-store.ts'
import { key as signKey } from './rounds.ts'
import { cookieValue, visitorOf } from './visitor.ts'

const DAY_MS = 86_400_000
const num = (v: string | undefined, d: number): number => {
  const t = (v ?? '').trim().toLowerCase()
  if (t === 'off' || t === '0') return Infinity
  return t !== '' && Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : d
}

export const MOMENTS_PER_DAY = 3
export const BONUS_PER_GIFT = 3
export const UNSENT_MAX = 10
export const UNSENT_DAYS = 30
export const IP_MOMENTS_PER_DAY = 30
export const IP_PICTURE_SETS_PER_DAY = 30

export const momentsPerDay = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_MOMENT_DAILY_MAX, MOMENTS_PER_DAY)
export const ipMomentsPerDay = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_MOMENT_IP_DAILY_MAX, IP_MOMENTS_PER_DAY)
export const unsentMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_UNSENT_MAX, UNSENT_MAX)
/** Picture sets: a moment draws ONE set, so the person's sets follow the person's moments (an explicit ICHIREI_PREVIEW_DAILY_MAX still wins); per connection 30. */
export const personPictureSets = (env: NodeJS.ProcessEnv, bonus: number): number => (env.ICHIREI_PREVIEW_DAILY_MAX !== undefined ? num(env.ICHIREI_PREVIEW_DAILY_MAX, 0) + bonus : momentsPerDay(env) + bonus)
export const ipPictureSets = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_PREVIEW_IP_DAILY_MAX, IP_PICTURE_SETS_PER_DAY)

/** Who a request is: every key we know the person by. `ip` is the connection (the backstop). */
export interface Who {
  browser?: string | null
  emails?: string[]
  account?: string | null
  ip: string
}

const hash = (k: string): string => createHash('sha256').update(k).digest('hex').slice(0, 32)
/** The keys of the PERSON (not the connection), most specific first: the account, each email, the browser. */
export function personKeys(w: Who): string[] {
  const out: string[] = []
  if (w.account) out.push(`a:${w.account}`)
  for (const e of w.emails ?? []) if (e) out.push(`e:${e.trim().toLowerCase()}`)
  if (w.browser) out.push(`b:${w.browser}`)
  return [...new Set(out)]
}
const ipKey = (ip: string): string => `i:${ip}`
const dayPath = (day: string, k: string): string => `limits/day/${day}/${hash(k)}.json`
const unsentPath = (k: string): string => `limits/unsent/${hash(k)}.json`
export const limitsLogPath = (day: string): string => `ops/limits-${day}.jsonl`

interface DayRec { n: number; bonus: number; pics: number }
interface UnsentRec { stamps: string[]; reset_at: string | null }
const emptyDay = (): DayRec => ({ n: 0, bonus: 0, pics: 0 })

async function readJson<T>(store: OrderStore, p: string): Promise<T | null> {
  try {
    const raw = await store.getObject(p)
    return raw ? (JSON.parse(raw.toString('utf8')) as T) : null
  } catch {
    return null
  }
}

const liveStamps = (r: UnsentRec | null, now: Date): string[] => (r?.stamps ?? []).filter((s) => now.getTime() - Date.parse(s) < UNSENT_DAYS * DAY_MS)

export type LimitCode = 'limit_person' | 'limit_ip' | 'limit_unpaid10'
export type Verdict = { ok: true; exempt?: boolean } | { ok: false; code: LimitCode }

/** What the dashboard line says about the person: a masked email or a short token. Never a full email. */
function labelOf(w: Who): { p: string; label: string } {
  const keys = personKeys(w)
  const k = keys[0] ?? ipKey(w.ip)
  const p = hash(k).slice(0, 8)
  const email = (w.emails ?? []).find(Boolean)
  const label = email && !w.account ? maskForLabel(email) : w.account ? `acct-${p}` : w.browser ? `V-${p}` : `ip-${p}`
  return { p, label }
}
const maskForLabel = (email: string): string => {
  const at = email.lastIndexOf('@')
  return at < 1 ? '•••' : `${[...email.slice(0, at)][0]}•••${email.slice(at)}`
}

async function logLine(store: OrderStore, w: Who, kind: 'moment' | 'pics', now: Date): Promise<void> {
  try {
    const { p, label } = labelOf(w)
    await store.appendJsonl(limitsLogPath(analyticsDay(now)), { ts: now.toISOString(), p, label, kind })
  } catch {
    // a counter is never a reason to lose a result
  }
}

/**
 * A NEW moment (round 1 of /api/select): refused when ANY of the person's keys has used its day (3 + the gifts given today × 3), when the connection has used its 30, or when ANY key
 * holds 10 moments not yet given in the last 30 days; otherwise recorded on every key. All counters are asked before any is recorded; each is then bumped under a compare-and-swap
 * that re-checks its limit (two copies of the server cannot both take the last place), and what was bumped is given back if a later one refuses.
 */
export async function claimMoment(store: OrderStore, who: Who, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<Verdict> {
  const day = analyticsDay(now)
  const keys = personKeys(who)
  const maxDay = momentsPerDay(env)
  const maxIp = ipMomentsPerDay(env)
  const maxUnsent = unsentMax(env)
  // 1 · ask
  const dayRecs = await Promise.all(keys.map((k) => readJson<DayRec>(store, dayPath(day, k))))
  const ipRec = await readJson<DayRec>(store, dayPath(day, ipKey(who.ip)))
  const unsentRecs = await Promise.all(keys.map((k) => readJson<UnsentRec>(store, unsentPath(k))))
  if (unsentRecs.some((r) => liveStamps(r, now).length >= maxUnsent)) return { ok: false, code: 'limit_unpaid10' }
  if (dayRecs.some((r) => (r?.n ?? 0) >= maxDay + (r?.bonus ?? 0))) return { ok: false, code: 'limit_person' }
  if ((ipRec?.n ?? 0) >= maxIp) return { ok: false, code: 'limit_ip' }
  // 2 · record (re-checked under the compare-and-swap)
  const done: Array<() => Promise<unknown>> = []
  let refused: LimitCode | null = null
  const bumpDay = async (k: string, cap: (r: DayRec) => number, code: LimitCode) => {
    if (refused) return
    let blocked = false
    await casJson<DayRec>(store, dayPath(day, k), (cur) => {
      const r = cur ?? emptyDay()
      if (r.n >= cap(r)) { blocked = true; return null }
      return { ...r, n: r.n + 1 }
    })
    if (blocked) refused = code
    else done.push(() => casJson<DayRec>(store, dayPath(day, k), (cur) => (cur ? { ...cur, n: Math.max(0, cur.n - 1) } : null)))
  }
  const bumpUnsent = async (k: string) => {
    if (refused) return
    let blocked = false
    await casJson<UnsentRec>(store, unsentPath(k), (cur) => {
      const stamps = liveStamps(cur, now)
      if (stamps.length >= maxUnsent) { blocked = true; return null }
      return { stamps: [...stamps, now.toISOString()], reset_at: cur?.reset_at ?? null }
    })
    if (blocked) refused = 'limit_unpaid10'
    else done.push(() => casJson<UnsentRec>(store, unsentPath(k), (cur) => (cur ? { ...cur, stamps: cur.stamps.filter((s) => s !== now.toISOString()) } : null)))
  }
  for (const k of keys) await bumpUnsent(k)
  for (const k of keys) await bumpDay(k, (r) => maxDay + r.bonus, 'limit_person')
  await bumpDay(ipKey(who.ip), () => maxIp, 'limit_ip')
  if (refused) {
    await Promise.all(done.map((u) => u().catch(() => null)))
    return { ok: false, code: refused }
  }
  await logLine(store, who, 'moment', now)
  return { ok: true }
}

/** A picture set for a NEW story (the card preview): the same keys, `pics` counted next to the moments; the person's sets follow their moments, the connection has its own. */
export async function claimPictureSet(store: OrderStore, who: Who, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<boolean> {
  const day = analyticsDay(now)
  const keys = personKeys(who)
  const cap = (r: DayRec | null): number => personPictureSets(env, r?.bonus ?? 0)
  const recs = await Promise.all(keys.map((k) => readJson<DayRec>(store, dayPath(day, k))))
  const ipRec = await readJson<DayRec>(store, dayPath(day, ipKey(who.ip)))
  if (recs.some((r) => (r?.pics ?? 0) >= cap(r)) || (ipRec?.pics ?? 0) >= ipPictureSets(env)) return false
  const done: Array<() => Promise<unknown>> = []
  let refused = false
  const bump = async (k: string, capOf: (r: DayRec) => number) => {
    if (refused) return
    let blocked = false
    await casJson<DayRec>(store, dayPath(day, k), (cur) => {
      const r = cur ?? emptyDay()
      if (r.pics >= capOf(r)) { blocked = true; return null }
      return { ...r, pics: r.pics + 1 }
    })
    if (blocked) refused = true
    else done.push(() => casJson<DayRec>(store, dayPath(day, k), (cur) => (cur ? { ...cur, pics: Math.max(0, cur.pics - 1) } : null)))
  }
  for (const k of keys) await bump(k, (r) => cap(r))
  await bump(ipKey(who.ip), () => ipPictureSets(env))
  if (refused) {
    await Promise.all(done.map((u) => u().catch(() => null)))
    return false
  }
  await logLine(store, who, 'pics', now)
  return true
}

/** A gift was GIVEN (paid, the promotion's free gift, or a gift back): today the person may write 3 more moments, and the count of moments not yet given goes back to 0. */
export async function creditGift(store: OrderStore, who: Omit<Who, 'ip'> & { ip?: string }, now: Date = new Date()): Promise<void> {
  const day = analyticsDay(now)
  for (const k of personKeys({ ...who, ip: who.ip ?? '' })) {
    await casJson<DayRec>(store, dayPath(day, k), (cur) => ({ ...(cur ?? emptyDay()), bonus: (cur?.bonus ?? 0) + BONUS_PER_GIFT })).catch(() => null)
    await casJson<UnsentRec>(store, unsentPath(k), () => ({ stamps: [], reset_at: now.toISOString() })).catch(() => null)
  }
}

// ---- the owner's own browsers --------------------------------------------------------------------------------------------------------------------------------------
export const EXEMPT_COOKIE = 'ic_x'
export const EXEMPT_MAX_AGE = 365 * 86_400
const exemptMac = (env: NodeJS.ProcessEnv): string => createHmac('sha256', signKey(env)).update('ic_x|owner').digest('base64url').slice(0, 32)
export const exemptSetCookie = (env: NodeJS.ProcessEnv = process.env): string => `${EXEMPT_COOKIE}=${exemptMac(env)}; Max-Age=${EXEMPT_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`
export function isExempt(req: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  const got = cookieValue(req.headers.get('cookie'), EXEMPT_COOKIE)
  if (!got) return false
  const want = Buffer.from(exemptMac(env))
  const have = Buffer.from(got)
  return want.length === have.length && timingSafeEqual(want, have)
}

// ---- the dashboard's day (ops/limits-<day>.jsonl) --------------------------------------------------------------------------------------------------------------------
export interface LimitsDay {
  moments: number
  people: number
  avg: number
  highest: number
  pictureSets: number
  top: Array<{ label: string; sets: number }>
}
export function summarizeLimits(lines: Array<{ p?: string; label?: string; kind?: string }>): LimitsDay {
  const moments = new Map<string, number>()
  const sets = new Map<string, { label: string; n: number }>()
  let pictureSets = 0
  let momentCount = 0
  for (const l of lines) {
    if (!l.p) continue
    if (l.kind === 'moment') { moments.set(l.p, (moments.get(l.p) ?? 0) + 1); momentCount++ }
    if (l.kind === 'pics') {
      pictureSets++
      const cur = sets.get(l.p) ?? { label: String(l.label ?? l.p).slice(0, 40), n: 0 }
      cur.n++
      sets.set(l.p, cur)
    }
  }
  const counts = [...moments.values()]
  return {
    moments: momentCount,
    people: counts.length,
    avg: counts.length ? Math.round((momentCount / counts.length) * 10) / 10 : 0,
    highest: counts.length ? Math.max(...counts) : 0,
    pictureSets,
    top: [...sets.values()].sort((a, b) => b.n - a.n).slice(0, 5).map((s) => ({ label: s.label, sets: s.n })),
  }
}

/** The person behind a request: the account (once signed in), every email the customer record holds, the browser token and the connection. */
export async function whoOf(store: OrderStore | null, req: Request, env: NodeJS.ProcessEnv = process.env, account: string | null = null): Promise<Who> {
  const browser = visitorOf(req, env)
  let emails: string[] = []
  if (store && browser) {
    try {
      emails = (await readCustomer(store, await customerIdOf(store, browser)))?.emails ?? []
    } catch {
      emails = []
    }
  }
  return { browser, emails, account, ip: clientIp(req) }
}
