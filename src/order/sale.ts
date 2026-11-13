// The Thanksgiving sale, as SHOWN on our site (2026-11-13). Our site never sets the price — Shopify's automatic discount does, at checkout; if the two ever disagree, Shopify wins and the
// owner keeps them in step. This only draws the old price struck through, the sale price beside it and one line of words, while the sale is on.
//
//   SALE_PERCENT   e.g. 30      (empty = no sale)             Cloud Build substitution _SALE_PERCENT
//   SALE_FROM      e.g. 2026-11-20  (a date, Japan time; the first day: the sale shows from 00:00)   Cloud Build substitution _SALE_FROM (empty = from now)
//   SALE_UNTIL     e.g. 2026-11-30  (a date, Japan time; the last day: the sale shows until 23:59)   Cloud Build substitution _SALE_UNTIL
// A percent without a valid SALE_UNTIL shows nothing. The server hands the sale to the page in GET /api/sizes until it is over; the page shows it only from `starts_at` to `ends_at` and switches
// itself on and off at those moments, so a page left open neither shows a sale that has not begun nor keeps one that is over.
//
// Plain TS with no React import so Node tests and the server can load it.

export interface Sale {
  /** Whole percent off, 1–90. */
  percent: number
  /** The first day of the sale, YYYY-MM-DD, Japan time (the sale shows from 00:00 of that day). */
  from: string
  /** The last day of the sale, YYYY-MM-DD, Japan time (the sale shows until 23:59:59 of that day). */
  until: string
  /** The start of the first day in Japan, as an instant (ISO). */
  starts_at: string
  /** The end of the last day in Japan, as an instant (ISO). */
  ends_at: string
}

const validDay = (v: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/**
 * The sale described by the settings, or null when there is none (empty, unreadable, from after until, or already over). A sale that has not started yet IS returned (the page shows it only inside
 * [starts_at, ends_at] and switches itself on at the start). `from` empty = it starts at once.
 */
export function parseSale(percentRaw: string | undefined | null, untilRaw: string | undefined | null, now: Date = new Date(), fromRaw?: string | null): Sale | null {
  const p = (percentRaw ?? '').trim().replace(/%$/, '')
  if (!/^\d{1,2}$/.test(p)) return null
  const percent = Number(p)
  if (percent < 1 || percent > 90) return null
  const until = (untilRaw ?? '').trim()
  if (!validDay(until)) return null
  const given = (fromRaw ?? '').trim()
  if (given !== '' && !validDay(given)) return null
  const from = given === '' ? '1970-01-01' : given
  if (from > until) return null
  const end = Date.parse(`${until}T23:59:59.999+09:00`)
  const start = Date.parse(`${from}T00:00:00.000+09:00`)
  if (!Number.isFinite(end) || !Number.isFinite(start) || now.getTime() > end) return null
  return { percent, from, until, starts_at: new Date(start).toISOString(), ends_at: new Date(end).toISOString() }
}

/** A sale from the page's own copy of it, only while it is on: from its first moment to its last (null before the start and after the end). */
export const saleOn = (sale: Sale | null | undefined, now: Date = new Date()): Sale | null =>
  sale && Date.parse(sale.starts_at) <= now.getTime() && Date.parse(sale.ends_at) >= now.getTime() ? sale : null

/** The sale price in whole yen, rounded DOWN: ¥3,980 at 30% → ¥2,786. (Integer arithmetic: no floating-point surprises.) */
export const salePriceJpy = (yen: number, percent: number): number => Math.floor((yen * (100 - percent)) / 100)

const ZH_DIGIT = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']
/** 30% off = 七折 (you pay seven tenths). A non-round percent is written with its digits (15% off = 8.5折). */
const zhFold = (percent: number): string => {
  const tenths = (100 - percent) / 10
  return Number.isInteger(tenths) && tenths >= 1 && tenths <= 9 ? `${ZH_DIGIT[tenths]}折` : `${tenths}折`
}

const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** The one line beside the price: ja 「感謝の季節に、30％オフ（11月30日まで）」 · zh-Hant 「感恩季節，七折優惠（至11月30日）」 · en "Thanksgiving: 30% off until November 30". */
export function saleLine(sale: Sale, lang: 'ja' | 'zh-Hant' | 'en'): string {
  const month = Number(sale.until.slice(5, 7))
  const day = Number(sale.until.slice(8, 10))
  if (lang === 'ja') return `感謝の季節に、${sale.percent}％オフ（${month}月${day}日まで）`
  if (lang === 'zh-Hant') return `感恩季節，${zhFold(sale.percent)}優惠（至${month}月${day}日）`
  return `Thanksgiving: ${sale.percent}% off until ${EN_MONTH[month - 1]} ${day}`
}
