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
  film: { status: 'ready' | 'fallback'; lines: string[]; scenes: string[] } | null
}
