import type { OrderLanguage } from './copy.ts'

/** What GET /api/animation/<id> answers (engine/animation.ts → animationView). */
export interface AnimationView {
  id: string
  language: OrderLanguage
  script: 'ja' | 'zh'
  glyph: string
  reading: string
  romanization: string
  meaning_en: string | null
  moment: string
  who: string
  memorial: boolean
  poem: { type: 'tanka' | 'tang' | 'ci' | 'en'; lines: string[]; lineAids: (string | null)[]; notes: string[] } | null
}

/** What GET /api/strokes answers (engine/stroke-data.ts). */
export type StrokeData =
  | { source: 'kanjivg'; box: 109; strokes: { d: string }[] }
  | { source: 'hanzi'; box: 1024; flip: string; strokes: { d: string; median: string }[] }
