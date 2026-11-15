// The US promotion "Days of Thanks" (2026-11-15). There is NO code logic in our app: the owner makes one 100%-off code a day in Shopify, and Shopify checks the code, the 100 uses and the
// one use per customer. All we know is WHEN the promotion runs (ICHIREI_PROMO_FROM / ICHIREI_PROMO_UNTIL — ISO times with an offset, empty = off; cloudbuild.yaml substitutions
// _PROMO_FROM / _PROMO_UNTIL), so the page can show one line and the picture capacity can be larger while it runs.

const toMs = (v: string | undefined): number | null => {
  const t = (v ?? '').trim()
  if (!t) return null
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : null
}

/** The promotion's window as instants, or null while it is off (either end missing or unreadable). */
export function promoWindow(env: NodeJS.ProcessEnv = process.env): { from: number; until: number } | null {
  const from = toMs(env.ICHIREI_PROMO_FROM)
  const until = toMs(env.ICHIREI_PROMO_UNTIL)
  return from !== null && until !== null && until > from ? { from, until } : null
}

/** True from the first instant to the last of the window. */
export function promoOn(env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): boolean {
  const w = promoWindow(env)
  return !!w && now.getTime() >= w.from && now.getTime() <= w.until
}

/** The site-wide picture capacity of previews per day while the promotion runs (ICHIREI_FILM_DAILY_MAX_PROMO, default 300). */
export const PROMO_FILM_DAILY_MAX = 300
export function promoFilmDailyMax(env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.ICHIREI_FILM_DAILY_MAX_PROMO)
  return env.ICHIREI_FILM_DAILY_MAX_PROMO !== undefined && env.ICHIREI_FILM_DAILY_MAX_PROMO.trim() !== '' && Number.isFinite(n) && n > 0 ? n : PROMO_FILM_DAILY_MAX
}

// ---- the promotion's numbers and its days (customer-loop ticket, 2026-11-15) ---------------------------------------------------------------------------------------------------------------
import { localInstant, partsOfZone } from '../src/order/opens-at.ts'

const int = (v: string | undefined, d: number): number => (v !== undefined && /^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : d)

/** Free gifts per promo day (ICHIREI_PROMO_DAILY, 100). */
export const promoDaily = (env: NodeJS.ProcessEnv = process.env): number => int(env.ICHIREI_PROMO_DAILY, 100)
/** How long a hold lasts (ICHIREI_PROMO_HOLD_MINUTES, 120). */
export const promoHoldMinutes = (env: NodeJS.ProcessEnv = process.env): number => int(env.ICHIREI_PROMO_HOLD_MINUTES, 120)
/** Holds one email may place per promo day (ICHIREI_PROMO_HOLDS_PER_DAY, 3). */
export const promoHoldsPerDay = (env: NodeJS.ProcessEnv = process.env): number => int(env.ICHIREI_PROMO_HOLDS_PER_DAY, 3)
/** Extra minutes a hold lives once its owner has gone to checkout (ICHIREI_PROMO_CHECKOUT_GRACE_MINUTES, 30). */
export const promoCheckoutGraceMinutes = (env: NodeJS.ProcessEnv = process.env): number => int(env.ICHIREI_PROMO_CHECKOUT_GRACE_MINUTES, 30)

export const PROMO_TZ = 'America/New_York'
/** A promo day runs from 4:00 a.m. to 3:59 a.m. US Eastern. */
export const PROMO_DAY_START_HOUR = 4

/** The key of the promo day an instant belongs to: the Eastern DATE the day started on. */
export function promoDayKey(now: Date): string {
  const p = partsOfZone(PROMO_TZ, now.getTime())
  if (p.hour >= PROMO_DAY_START_HOUR) return p.date
  const d = new Date(`${p.date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/** The instant the promo day of `now` ends: the next 4:00 a.m. Eastern. */
export function promoDayEnd(now: Date): Date {
  const key = promoDayKey(now)
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  const next = d.toISOString().slice(0, 10)
  return localInstant(next, PROMO_DAY_START_HOUR, PROMO_TZ, 0) ?? new Date(`${next}T09:00:00Z`)
}
