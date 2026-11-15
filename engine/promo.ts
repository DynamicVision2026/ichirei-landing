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
