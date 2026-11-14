// The sender's words of the gift ceremony (2026-11-14): when it opens, the calendar, the states of the gift, the answer. ja / zh-Hant / en are the owner's strings; lines marked DERIVED are not in the ticket
// and follow the nearest wording. zh-Hans reads as zh-Hant on this page, like every customer page.

import type { PageLang } from './copy.ts'
import { zoneName, type OpensLang } from '../order/opens-at.ts'

export interface CeremonyCopy {
  /** DERIVED: the heading of the opening choices */
  whenTitle: string
  toggle: string
  set: string
  saving: string
  clear: string
  saved: (label: string) => string
  error: string
  dateLabel: string
  timeLabel: string
  // the states (part 7)
  wrapped: string
  sent: string
  opened: (when: string) => string
  answered: string
  answerChar: (word: string) => string
}

export const CEREMONY_COPY: Record<PageLang, CeremonyCopy> = {
  ja: {
    whenTitle: 'いつ開けますか',
    toggle: '開く日時を指定する',
    set: '設定する',
    saving: '保存しています…',
    clear: 'すぐに開けるようにする',
    saved: (l) => `設定しました。${l}`,
    error: '保存できませんでした。もう一度お試しください。',
    dateLabel: '日付',
    timeLabel: '時刻',
    wrapped: '包みました',
    sent: '送りました',
    opened: (w) => `開かれました（${w}）`,
    answered: 'お返しが届きました',
    answerChar: (w) => `返ってきた一字：${w}`,
  },
  'zh-Hant': {
    whenTitle: '什麼時候開啟',
    toggle: '指定開啟時間',
    set: '設定',
    saving: '儲存中…',
    clear: '改為立即開啟',
    saved: (l) => `已設定。${l}`,
    error: '無法儲存，請再試一次。',
    dateLabel: '日期',
    timeLabel: '時間',
    wrapped: '已包好',
    sent: '已送出',
    opened: (w) => `已開啟（${w}）`,
    answered: '收到回禮了',
    answerChar: (w) => `回來的一個字：${w}`,
  },
  en: {
    whenTitle: 'When should it open?',
    toggle: 'Schedule for a date',
    set: 'Set the date',
    saving: 'Saving…',
    clear: 'Open at once',
    saved: (l) => `Scheduled. ${l}`,
    error: 'It could not be saved. Please try again.',
    dateLabel: 'Date',
    timeLabel: 'Time',
    wrapped: 'Wrapped',
    sent: 'Sent',
    opened: (w) => `Opened (${w})`,
    answered: 'Answered',
    answerChar: (w) => `The character that came back: ${w}`,
  },
}

const EN_MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** When something happened, in the zone given: en "Dec 25, 7:12 a.m." · ja 「12月25日 午前7:12」 · zh-Hant 「12月25日 上午7:12」. */
export function stateTime(lang: OpensLang, iso: string, tz: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]))
  const hour = Number(p.hour)
  const minute = p.minute
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  const pm = hour >= 12
  if (lang === 'en') return `${EN_MONTH[Number(p.month) - 1]} ${Number(p.day)}, ${h12}:${minute} ${pm ? 'p.m.' : 'a.m.'}`
  const half = lang === 'ja' ? (pm ? '午後' : '午前') : pm ? '下午' : '上午'
  return `${Number(p.month)}月${Number(p.day)}日 ${half}${h12}:${minute}`
}

export { zoneName }
