// "Add to calendar" (gift ceremony ticket, part 3). One event at the opening moment, 15 minutes long, with an alert one day before and one at the moment.
// The description holds the receiver's link and the sender's private page link — never the character and never the moment's text. Pure code, shared by the page and the tests.

export type CalLang = 'ja' | 'zh-Hant' | 'en'

export const CAL_BUTTON: Record<CalLang, { add: string; google: string; ics: string }> = {
  ja: { add: 'カレンダーに追加', google: 'Google カレンダー', ics: 'ファイルをダウンロード（Apple・Outlook）' },
  'zh-Hant': { add: '加入行事曆', google: 'Google 日曆', ics: '下載檔案（Apple、Outlook）' },
  en: { add: 'Add to calendar', google: 'Google Calendar', ics: 'Download .ics (Apple, Outlook)' },
}

/** The event title: with the receiver's name when there is one. */
export function eventTitle(lang: CalLang, to: string): string {
  const n = to.trim()
  if (lang === 'ja') return n ? `${n}に一字礼を贈る` : '一字礼を贈る'
  if (lang === 'zh-Hant') return n ? `把一字禮送給${n}` : '送出一字禮'
  return n ? `Give ${n} their ICHIREI` : 'Give your ICHIREI'
}

export interface CalendarEvent {
  lang: CalLang
  to: string
  /** the opening moment (UTC instant, ISO) */
  start: string
  /** the receiver's link and the sender's private page link */
  giftUrl: string
  senderUrl: string
}

const DESCRIPTION: Record<CalLang, (g: string, s: string) => string> = {
  ja: (g, s) => `相手のリンク: ${g}\nあなたのページ: ${s}`,
  'zh-Hant': (g, s) => `對方的連結：${g}\n你的頁面：${s}`,
  en: (g, s) => `Their link: ${g}\nYour page: ${s}`,
}

const stamp = (ms: number): string => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
const MIN15 = 15 * 60_000

const details = (e: CalendarEvent): { title: string; description: string; from: number; to: number } | null => {
  const from = Date.parse(e.start)
  if (!Number.isFinite(from)) return null
  return { title: eventTitle(e.lang, e.to), description: DESCRIPTION[e.lang](e.giftUrl, e.senderUrl), from, to: from + MIN15 }
}

/** The Google Calendar "create event" link (dates in UTC). */
export function googleCalendarUrl(e: CalendarEvent): string | null {
  const d = details(e)
  if (!d) return null
  const q = new URLSearchParams({ action: 'TEMPLATE', text: d.title, dates: `${stamp(d.from)}/${stamp(d.to)}`, details: d.description })
  return `https://calendar.google.com/calendar/render?${q.toString()}`
}

const esc = (t: string): string => t.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\r?\n/g, '\\n')

/** RFC 5545 folding: lines of at most 75 octets, continued with a space. */
function fold(line: string): string[] {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let len = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (len + n > (out.length === 0 ? 75 : 74)) {
      out.push(cur)
      cur = ''
      len = 0
    }
    cur += ch
    len += n
  }
  out.push(cur)
  return out.map((l, i) => (i === 0 ? l : ` ${l}`))
}

/** The .ics file (UTC times; two alerts: one day before and at the moment). `uid` keeps the event the same when it is added again. */
export function icsText(e: CalendarEvent, uid: string, now: Date = new Date()): string | null {
  const d = details(e)
  if (!d) return null
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ICHIREI//Gift//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}@ichirei.beyondculture.ai`,
    `DTSTAMP:${stamp(now.getTime())}`,
    `DTSTART:${stamp(d.from)}`,
    `DTEND:${stamp(d.to)}`,
    `SUMMARY:${esc(d.title)}`,
    `DESCRIPTION:${esc(d.description)}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(d.title)}`,
    'TRIGGER:-P1D',
    'END:VALARM',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(d.title)}`,
    'TRIGGER:PT0S',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.flatMap(fold).join('\r\n') + '\r\n'
}
