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
  /** The poem of the gift (the receiver's page and the buyer's preview carry it; a sample film has none): the e-card the film ends on shows it. */
  poem?: { type: string; lines: string[]; reading?: string } | null
  memorial: boolean
  /** v9.6: why the gift is given (absent on older gifts). */
  purpose?: string | null
  /** null = the script is still being written; pictures null = drawn on the first open (the page asks POST /api/film/<id>/render); deferred = the daily limit. */
  film: { status: 'ready' | 'fallback'; lines: string[]; pictures: string[] | null; deferred?: boolean; incomplete?: boolean } | null
  /** The sender's page only: what to share with the receiver and where the order stands. */
  gift?: { url: string; size_code: string; ship_to: string; egift_state: 'waiting' | 'received' | null; opens_on: string | null; certificate_no: number | null; reply: { text: string; at: string } | null } | null
  /** The buyer's page only: when it was ordered, the end of the 24-hour change window while it is open (else null), and the wooden gift's step (null = no wood section). */
  order?: { collected: boolean; ordered_at: string | null; change_until: string | null; wood: { step: 1 | 2 | 3 | 4; tracking_no: string | null; ship_to: 'me' | 'direct' } | null } | null
  /** The shop's support address, printed as plain text; null / absent = left out. */
  support_email?: string | null
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
  /** The buyer has not collected the gift yet: a sealed envelope with no open button. */
  arriving?: boolean
}
