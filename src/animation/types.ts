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
  film: { status: 'ready' | 'fallback'; lines: string[]; pictures: string[] | null; deferred?: boolean } | null
}
