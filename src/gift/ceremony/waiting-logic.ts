import { clockIn, clockText, dateInZone, openingDayText, zoneName, type OpensLang } from '../../order/opens-at.ts'

// The pure part of the waiting screen (Part 11, 2026-11-20): the moment a locked gift opens, how it is written, and how far away it is.

const EN_MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const JST_OFFSET = '+09:00'

export interface Waiting {
  opens_on: string | null
  opens_at?: string | null
  opens_tz?: string | null
}

/** The moment it opens: the stored instant, or — for a gift made before exact moments — Japan midnight of its date (the same instant the server locks until). */
export function openingMoment(w: Waiting): { at: number; tz: string; date: string; hour: number; minute: number } | null {
  if (w.opens_at && w.opens_tz) {
    const at = Date.parse(w.opens_at)
    const date = dateInZone(w.opens_at, w.opens_tz)
    const c = clockIn(w.opens_at, w.opens_tz)
    if (Number.isFinite(at) && date && c) return { at, tz: w.opens_tz, date, hour: c.hour, minute: c.minute }
  }
  if (w.opens_on && /^\d{4}-\d{2}-\d{2}$/.test(w.opens_on)) {
    const at = Date.parse(`${w.opens_on}T00:00:00${JST_OFFSET}`)
    if (Number.isFinite(at)) return { at, tz: 'Asia/Tokyo', date: w.opens_on, hour: 0, minute: 0 }
  }
  return null
}

/** "November 21" / 「11月21日」 and the clock as each language writes it. */
export function openingParts(lang: OpensLang, m: { date: string; hour: number; minute: number; tz: string }): { day: string; clock: string; zone: string } {
  const [, , mo, d] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(m.date) ?? []
  const day = lang === 'en' && mo ? `${EN_MONTH[Number(mo) - 1]} ${Number(d)}` : openingDayText(lang, m.date)
  const h12 = m.hour % 12 === 0 ? 12 : m.hour % 12
  const clock = lang === 'en' ? `${h12}:${String(m.minute).padStart(2, '0')} ${m.hour >= 12 ? 'PM' : 'AM'}` : clockText(lang, m.hour, m.minute)
  return { day, clock, zone: zoneName(lang, m.tz) }
}

/** More than a day to go: whole days (rounded up); the last day: hours (rounded up); the last hour: soon. */
export function countdownKind(ms: number): { kind: 'days' | 'hours' | 'soon'; n: number } {
  if (ms > 86_400_000) return { kind: 'days', n: Math.ceil(ms / 86_400_000) }
  if (ms > 3_600_000) return { kind: 'hours', n: Math.ceil(ms / 3_600_000) }
  return { kind: 'soon', n: 0 }
}

