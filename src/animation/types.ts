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
  /** null = the script is still being written; pictures null = drawn on the first open (the page asks POST /api/film/<id>/render); deferred = the daily limit. */
  film: { status: 'ready' | 'fallback'; lines: string[]; pictures: string[] | null; deferred?: boolean; incomplete?: boolean } | null
  /** The sender's page only: what to share with the receiver and where the order stands. */
  gift?: { url: string; size_code: string; ship_to: string; egift_state: 'waiting' | 'received' | null } | null
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
}
