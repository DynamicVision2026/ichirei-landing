// When the envelope opens — the sender's four choices (gift ceremony ticket, part 2). Pure code (Intl only), shared by the page and the tests.
//   now          opens at once (no date is stored)
//   christmas    Dec 25, 7:00 a.m. in the chosen zone — offered only from Dec 1 to Dec 24
//   thanksgiving Nov 26-style (the 4th Thursday of November), 6:00 p.m. — English only, and only until that moment has passed
//   pick         a date and a time the sender chooses (the time defaults to 7:00 a.m.)
// Every stored moment is a UTC instant (`opens_at`) with the IANA zone it was picked in (`opens_tz`), as for A8.

import { isValidZone, localInstant, todayIn, DEFAULT_ZONE, OPEN_HOUR, type OpensLang } from './opens-at.ts'

export type ChoiceId = 'now' | 'christmas' | 'thanksgiving' | 'pick'

export interface ChoiceTarget {
  /** YYYY-MM-DD on the wall clock of `tz`. */
  date: string
  hour: number
  minute: number
  instant: Date
}

/** Words of the four choices. zh-Hans reads as zh-Hant on the page, like every customer page. */
export const CHOICE_COPY: Record<'ja' | 'zh-Hant' | 'en', { label: string; now: string; christmas: string; thanksgiving: string; pick: string; zone: string }> = {
  ja: { label: 'いつ開けますか', now: 'すぐに開ける', christmas: 'クリスマスの朝（12月25日 午前7時）', thanksgiving: '', pick: '日時を選ぶ', zone: '受け取る方の場所' },
  'zh-Hant': { label: '什麼時候開啟', now: '立即開啟', christmas: '聖誕節早上（12月25日 上午7點）', thanksgiving: '', pick: '選擇日期與時間', zone: '對方所在的時區' },
  en: { label: 'When should it open?', now: 'Now', christmas: 'Christmas morning (Dec 25, 7:00 a.m.)', thanksgiving: 'Thanksgiving dinner (Nov 26, 6:00 p.m.)', pick: 'Pick a date and time', zone: 'Where will they open it?' },
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** The 4th Thursday of November of `year` (YYYY-MM-DD). */
export function thanksgivingDate(year: number): string {
  const first = new Date(Date.UTC(year, 10, 1)).getUTCDay() // 0 Sun … 4 Thu
  const firstThursday = 1 + ((4 - first + 7) % 7)
  return `${year}-11-${pad(firstThursday + 21)}`
}

const parts = (date: string): [number, number, number] => {
  const [y, m, d] = date.split('-').map(Number)
  return [y, m, d]
}

/** The Christmas moment (Dec 25, 7:00 a.m. in `tz`) while it may still be offered: from Dec 1 to Dec 24 on the wall clock of `tz`; otherwise null. */
export function christmasTarget(now: Date, tz: string): ChoiceTarget | null {
  const z = isValidZone(tz) ? tz : DEFAULT_ZONE
  const today = todayIn(z, now)
  const [y, m, d] = parts(today)
  if (m !== 12 || d > 24) return null
  const date = `${y}-12-25`
  const instant = localInstant(date, OPEN_HOUR, z)
  return instant ? { date, hour: OPEN_HOUR, minute: 0, instant } : null
}

/** Thanksgiving dinner (6:00 p.m. on the 4th Thursday of November) while it is still ahead; otherwise null. English only — the caller decides the language. */
export function thanksgivingTarget(now: Date, tz: string): ChoiceTarget | null {
  const z = isValidZone(tz) ? tz : DEFAULT_ZONE
  const year = Number(todayIn(z, now).slice(0, 4))
  const date = thanksgivingDate(year)
  const instant = localInstant(date, 18, z)
  return instant && instant.getTime() > now.getTime() ? { date, hour: 18, minute: 0, instant } : null
}

/** The choices to show now, in order. Memorial and quiet gifts get no Christmas or Thanksgiving. */
export function availableChoices(now: Date, tz: string, lang: OpensLang, quiet: boolean): ChoiceId[] {
  const out: ChoiceId[] = ['now']
  if (!quiet && christmasTarget(now, tz)) out.push('christmas')
  if (!quiet && lang === 'en' && thanksgivingTarget(now, tz)) out.push('thanksgiving')
  out.push('pick')
  return out
}

/** The moment a picked date and time (`HH:MM`, default 7:00) mean in `tz`; null for an invalid input. */
export function pickTarget(date: string, time: string | null | undefined, tz: string): ChoiceTarget | null {
  const t = /^(\d{2}):(\d{2})$/.exec(time ?? `${pad(OPEN_HOUR)}:00`)
  if (!t || Number(t[1]) > 23 || Number(t[2]) > 59) return null
  const instant = localInstant(date, Number(t[1]), tz, Number(t[2]))
  return instant ? { date, hour: Number(t[1]), minute: Number(t[2]), instant } : null
}
