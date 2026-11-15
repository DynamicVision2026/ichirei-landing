// When an envelope opens (2026-11-14, A8). The buyer picks a DATE; the gift opens at 7:00 a.m. on that date in the time zone the buyer chose — so "Christmas morning" is Christmas morning
// where the receiver is, not Dec 24 in New York (Dec 25 00:00 JST = Dec 24 10:00 a.m. Eastern). The exact moment is stored as a UTC instant (`opens_at`) with the IANA zone (`opens_tz`).
// Gifts made before this change keep their date-only rule (Japan midnight). Plain TS (Intl only) so Node tests, the server and the pages share it.

export const OPEN_HOUR = 7
export const DEFAULT_ZONE = 'Asia/Tokyo'

export interface ZoneChoice {
  id: string
  en: string
  ja: string
  zh: string
  hans: string
}

/** The short list in the zone picker; any other IANA zone is accepted as "other". */
export const ZONE_CHOICES: readonly ZoneChoice[] = [
  { id: 'America/New_York', en: 'Eastern', ja: '米国東部時間', zh: '美東時間', hans: '美东时间' },
  { id: 'America/Chicago', en: 'Central', ja: '米国中部時間', zh: '美中時間', hans: '美中时间' },
  { id: 'America/Denver', en: 'Mountain', ja: '米国山岳部時間', zh: '美山區時間', hans: '美山区时间' },
  { id: 'America/Los_Angeles', en: 'Pacific', ja: '米国太平洋時間', zh: '美西時間', hans: '美西时间' },
  { id: 'Europe/London', en: 'UK', ja: '英国時間', zh: '英國時間', hans: '英国时间' },
  { id: 'Asia/Tokyo', en: 'Japan', ja: '日本時間', zh: '日本時間', hans: '日本时间' },
  { id: 'Asia/Taipei', en: 'Taipei', ja: '台北時間', zh: '台北時間', hans: '台北时间' },
]

export const isValidZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

const partsOf = (tz: string, ms: number): Record<string, string> => {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return Object.fromEntries(f.formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
}

/** The wall clock of a zone at an instant: its calendar date (YYYY-MM-DD) and hour / minute. */
export function partsOfZone(tz: string, ms: number): { date: string; hour: number; minute: number } {
  const p = partsOf(tz, ms)
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) }
}

/** The zone's offset from UTC at that instant, in ms. */
const offsetMs = (tz: string, ms: number): number => {
  const p = partsOf(tz, ms)
  return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - Math.floor(ms / 1000) * 1000
}

/** The instant at which the wall clock of `tz` reads `date` `hour`:00 (YYYY-MM-DD). null when the date or the zone is not valid. */
export function localInstant(date: string, hour: number, tz: string, minute = 0): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m || !isValidZone(tz)) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour, minute)
  let guess = wall
  for (let i = 0; i < 4; i++) {
    const next = wall - offsetMs(tz, guess)
    if (next === guess) break
    guess = next
  }
  return new Date(guess)
}

/** Today's date (YYYY-MM-DD) on the wall clock of `tz`. */
export function todayIn(tz: string, now: Date): string {
  const p = partsOf(isValidZone(tz) ? tz : DEFAULT_ZONE, now.getTime())
  return `${p.year}-${p.month}-${p.day}`
}

/** The opening moment for a picked date and zone: 7:00 a.m. there. null for an invalid pair. */
export const openingInstant = (date: string, tz: string): Date | null => localInstant(date, OPEN_HOUR, tz)

export type OpensLang = 'ja' | 'zh-Hant' | 'zh-Hans' | 'en'

/** The zone as the customer reads it: the chosen name ("Eastern", 「日本時間」, 「台北時間」); another IANA zone shows its city ("Sydney"). */
export function zoneName(lang: OpensLang, tz: string): string {
  const hit = ZONE_CHOICES.find((z) => z.id === tz)
  if (hit) return lang === 'en' ? hit.en : lang === 'ja' ? hit.ja : lang === 'zh-Hans' ? hit.hans : hit.zh
  return tz.split('/').pop()!.replace(/_/g, ' ')
}

const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The date part alone: "Dec 25" / 「12月25日」. */
export function openingDayText(lang: OpensLang, date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!m) return date
  return lang === 'en' ? `${EN_MONTH[Number(m[2]) - 1]} ${Number(m[3])}` : `${Number(m[2])}月${Number(m[3])}日`
}

/**
 * Where it appears: en "Opens Dec 25, 7:00 a.m. (Eastern)" · ja 「12月25日 午前7時（日本時間）に開きます」 · zh-Hant 「12月25日上午7點（台北時間）開啟」.
 * `date` is the picked calendar date (wall clock of `tz`).
 */
export function openingLabel(lang: OpensLang, date: string, tz: string): string {
  const day = openingDayText(lang, date)
  const zone = zoneName(lang, tz)
  return lang === 'en' ? `Opens ${day}, 7:00 a.m. (${zone})` : lang === 'ja' ? `${day} 午前7時（${zone}）に開きます` : lang === 'zh-Hans' ? `${day}上午7点（${zone}）开启` : `${day}上午7點（${zone}）開啟`
}

/** The clock time of an instant on the wall clock of `tz`, as the customer reads it: en "7:00 a.m." · ja 「午前7時」 · zh 「上午7點」 (minutes only when there are some: 「午後6時30分」). */
export function clockText(lang: OpensLang, hour: number, minute: number): string {
  const pm = hour >= 12
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  if (lang === 'en') return `${h12}:${String(minute).padStart(2, '0')} ${pm ? 'p.m.' : 'a.m.'}`
  const zh = lang === 'zh-Hant' || lang === 'zh-Hans'
  const mm = minute ? (zh ? `${minute}分` : `${minute}分`) : ''
  if (lang === 'ja') return `${pm ? '午後' : '午前'}${h12}時${mm}`
  return `${pm ? '下午' : '上午'}${h12}${lang === 'zh-Hans' ? '点' : '點'}${mm}`
}

/** The wall-clock hour and minute of an instant in `tz` (null for an invalid pair). */
export function clockIn(instantIso: string, tz: string): { hour: number; minute: number } | null {
  const t = Date.parse(instantIso)
  if (!Number.isFinite(t) || !isValidZone(tz)) return null
  const p = partsOf(tz, t)
  return { hour: Number(p.hour), minute: Number(p.minute) }
}

/** Like openingLabel, for any time of day: en "Opens Nov 26, 6:00 p.m. (Eastern)" · ja 「11月26日 午後6時（米国東部時間）に開きます」. */
export function openingLabelAt(lang: OpensLang, date: string, hour: number, minute: number, tz: string): string {
  const day = openingDayText(lang, date)
  const zone = zoneName(lang, tz)
  const clock = clockText(lang, hour, minute)
  return lang === 'en' ? `Opens ${day}, ${clock} (${zone})` : lang === 'ja' ? `${day} ${clock}（${zone}）に開きます` : lang === 'zh-Hans' ? `${day}${clock}（${zone}）开启` : `${day}${clock}（${zone}）開啟`
}

/** The sealed envelope's own line (no zone): en "Opens Dec 25, 7:00 a.m." · ja 「12月25日 午前7時に開きます」 · zh-Hant 「12月25日上午7點開啟」. Memorial gifts use the same words (a date, never a countdown joke). */
export function openingLabelShortFromRecord(lang: OpensLang, opensAt: string | null | undefined, opensTz: string | null | undefined): string | null {
  if (!opensAt || !opensTz) return null
  const d = dateInZone(opensAt, opensTz)
  const c = clockIn(opensAt, opensTz)
  if (!d || !c) return null
  const day = openingDayText(lang, d)
  const clock = clockText(lang, c.hour, c.minute)
  return lang === 'en' ? `Opens ${day}, ${clock}` : lang === 'ja' ? `${day} ${clock}に開きます` : lang === 'zh-Hans' ? `${day}${clock}开启` : `${day}${clock}開啟`
}

/** The calendar date of an instant on the wall clock of `tz` (so the label can be written from a stored `opens_at`). */
export function dateInZone(instantIso: string, tz: string): string | null {
  const t = Date.parse(instantIso)
  if (!Number.isFinite(t) || !isValidZone(tz)) return null
  const p = partsOf(tz, t)
  return `${p.year}-${p.month}-${p.day}`
}

/** The label from what a record stores; null for an old record (a date only). */
export function openingLabelFromRecord(lang: OpensLang, opensAt: string | null | undefined, opensTz: string | null | undefined): string | null {
  if (!opensAt || !opensTz) return null
  const d = dateInZone(opensAt, opensTz)
  const c = clockIn(opensAt, opensTz)
  return d && c ? openingLabelAt(lang, d, c.hour, c.minute, opensTz) : null
}

/** The zone of the visitor's browser when it is usable, else Japan. */
export function browserZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidZone(tz) ? tz : DEFAULT_ZONE
  } catch {
    return DEFAULT_ZONE
  }
}
