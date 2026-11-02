import type { OrderLanguage } from './copy.ts'

/** What GET /api/animation/<id> answers (engine/animation.ts → animationView). `film: null` = the script is still being written. */
export interface AnimationView {
  id: string
  language: OrderLanguage
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  who: string
  memorial: boolean
  /** v9.6: why the gift is given (absent on older gifts). */
  purpose?: string | null
  /** null = the script is still being written; pictures null = drawn on the first open (the page asks POST /api/film/<id>/render); deferred = the daily limit. */
  film: { status: 'ready' | 'fallback'; lines: string[]; pictures: string[] | null; deferred?: boolean; incomplete?: boolean } | null
  /** The sender's page only: what to share with the receiver and where the order stands. */
  gift?: { url: string; size_code: string; ship_to: string; egift_state: 'waiting' | 'received' | null; opens_on: string | null; certificate_no: number | null; reply: { text: string; at: string } | null } | null
}

/** What GET /api/gift/<token> answers (engine/gift.ts → giftView): the receiver's page. `id` is the receiver's own token — never the sender's. */
export interface GiftView extends AnimationView {
  token: string
  certificate_line: string
  poem: { type: string; lines: string[]; reading: string } | null
  from: string
  to: string
  message: string
  egift: { state: 'waiting' | 'received'; japan_only: boolean } | null
  locked: false
  /** 「一字礼　第 NNNN 号」 — the running number (null on gifts made before numbers existed). */
  certificate_no: number | null
  /** The day it was ordered, and the day the envelope opens (null = at once); YYYY-MM-DD, Japan time. */
  order_date: string
  opens_on: string | null
  /** True once the receiver has sent their one thank-you (its text is for the sender's page only). */
  replied: boolean
  package: 'egift' | 'simple' | 'standard'
}

/** The closed envelope before the opening date: the two names and the date, nothing else. */
export interface GiftLockedView {
  locked: true
  token: string
  language: OrderLanguage
  memorial: boolean
  purpose?: string | null
  from: string
  to: string
  opens_on: string
  days_left: number
}
