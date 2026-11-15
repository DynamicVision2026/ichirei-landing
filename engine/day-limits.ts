// Daily counters for the free tries (2026-11-15). A limit here is friction for casual overuse, never a block on paying: only /api/select (new moments, rounds) and the card
// preview's pictures use them; checkout and payment never do.
//
//   per person  — keyed by the browser token (engine/visitor.ts)
//   per address — the backstop, keyed by the LAST X-Forwarded-For hop (engine/rate-limit.ts clientIp)
//   site        — one count for everybody (read from the order store's daily log when there is one, so every instance sees the same number)
//
// A day is the Japan-time day the dashboard uses. Counts are kept in this process (a brake, not an exact quota) except the site count.

import { analyticsDay } from './analytics.ts'
import { SlidingWindowLimiter } from './rate-limit.ts'
import type { OrderStore } from './order-store.ts'

const DAY_MS = 86_400_000
/** A limit from the environment: a number, or "off" / 0 for none. */
const num = (v: string | undefined, d: number): number => {
  const t = (v ?? '').trim().toLowerCase()
  if (t === 'off' || t === '0') return Infinity
  return t !== '' && Number.isFinite(Number(t)) && Number(t) > 0 ? Number(t) : d
}

export const NEW_MOMENT_PERSON_MAX = 20
export const NEW_MOMENT_IP_MAX = 100
export const SELECT_SITE_MAX = 2000

export const personMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_MOMENT_DAILY_MAX, NEW_MOMENT_PERSON_MAX)
export const ipMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_MOMENT_IP_DAILY_MAX, NEW_MOMENT_IP_MAX)
export const selectSiteMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_SELECT_DAILY_MAX, SELECT_SITE_MAX)
/** The preview's picture sets: per person 5 a day (ICHIREI_PREVIEW_DAILY_MAX), per connection as the backstop (ICHIREI_PREVIEW_IP_DAILY_MAX, 25). */
export const previewPersonMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_PREVIEW_DAILY_MAX, 5)
export const previewIpMax = (env: NodeJS.ProcessEnv = process.env): number => num(env.ICHIREI_PREVIEW_IP_DAILY_MAX, 25)

/** A set of counters that follows its limits (read from the environment on every call, like the other limiters). */
export class DailyLimiter {
  private lim: SlidingWindowLimiter | null = null
  private max = -1
  private readonly read: (env: NodeJS.ProcessEnv) => number
  constructor(read: (env: NodeJS.ProcessEnv) => number) {
    this.read = read
  }
  private for(env: NodeJS.ProcessEnv): SlidingWindowLimiter {
    const m = this.read(env)
    if (!this.lim || this.max !== m) {
      this.lim = new SlidingWindowLimiter(m, DAY_MS)
      this.max = m
    }
    return this.lim
  }
  /** Would one more be refused? (records nothing) */
  blocked(key: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
    return this.for(env).blocked(key, now)
  }
  hit(key: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): boolean {
    return this.for(env).hit(key, now)
  }
  reset(): void {
    this.lim = null
    this.max = -1
  }
}

export type MomentVerdict = { ok: true } | { ok: false; code: 'limit_person' | 'limit_site' }

const person = new DailyLimiter(personMax)
const address = new DailyLimiter(ipMax)
/** The card preview's picture sets (engine/preview.ts): the same two keys, their own limits. */
export const previewPerson = new DailyLimiter(previewPersonMax)
export const previewAddress = new DailyLimiter(previewIpMax)

/**
 * A NEW moment (round 1 of /api/select): refused with `limit_person` when this browser (or, as the backstop, this connection) has used its day, recorded otherwise.
 * `visitor` null (no usable token) counts by connection only. Both counters are checked before either is recorded.
 */
export function newMoment(visitor: string | null, ip: string, env: NodeJS.ProcessEnv = process.env, now = Date.now()): MomentVerdict {
  if ((visitor && person.blocked(visitor, env, now)) || address.blocked(ip, env, now)) return { ok: false, code: 'limit_person' }
  if (visitor) person.hit(visitor, env, now)
  address.hit(ip, env, now)
  return { ok: true }
}

// ---- the whole site's card rounds per day ----------------------------------------------------------------------------------------------------------------------
let siteDay = ''
let siteLocal = 0
let siteSynced: { at: number; remote: number; localAtSync: number } | null = null
const SYNC_MS = 30_000

/** The day's card rounds so far: this process's own, or — when the store holds the day's main-character log (one line per finished run, engine/free-source.ts) — the larger of the two. */
async function siteCount(store: OrderStore | null, now: Date): Promise<number> {
  const day = analyticsDay(now)
  if (day !== siteDay) {
    siteDay = day
    siteLocal = 0
    siteSynced = null
  }
  if (!store) return siteLocal
  if (!siteSynced || now.getTime() - siteSynced.at > SYNC_MS) {
    try {
      const raw = await store.getObject(`ops/mains-${day}.jsonl`)
      const remote = raw ? raw.toString('utf8').split('\n').filter(Boolean).length : 0
      siteSynced = { at: now.getTime(), remote, localAtSync: siteLocal }
    } catch {
      // the store could not be read: the process's own count stands
    }
  }
  return siteSynced ? Math.max(siteLocal, siteSynced.remote + (siteLocal - siteSynced.localAtSync)) : siteLocal
}

/** One more card round for the whole site: false (`limit_site`) when the day's maximum is used up. */
export async function siteRound(store: OrderStore | null, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<boolean> {
  const max = selectSiteMax(env)
  if (max > 0 && (await siteCount(store, now)) >= max) return false
  siteLocal++
  return true
}

/** Tests: forget every count. */
export function resetDayLimits(): void {
  person.reset()
  address.reset()
  previewPerson.reset()
  previewAddress.reset()
  siteDay = ''
  siteLocal = 0
  siteSynced = null
}
