// Which glyph is carved, given the language and the sender's choice on the order form.
//   ja:      kyūjitai (the brand standard) or the modern form
//   zh-*:    traditional (the brand standard) or simplified
// The engine's candidate holds `kanji` (ja: modern; zh: SIMPLIFIED) and `inscription_form`
// (ja: kyūjitai; zh: TRADITIONAL; null when there is no distinct form).
// Plain TS, no imports: shared by the browser and the server.

export type OrderLanguage = 'ja' | 'zh-Hans' | 'zh-Hant'
export type InscriptionStyle = 'kyujitai' | 'modern' | 'traditional' | 'simplified'

export const STYLES_BY_LANGUAGE: Record<OrderLanguage, readonly InscriptionStyle[]> = {
  ja: ['kyujitai', 'modern'],
  'zh-Hans': ['traditional', 'simplified'],
  'zh-Hant': ['traditional', 'simplified'],
}

/** The brand-standard choice for a language (what the form pre-selects). */
export const DEFAULT_STYLE: Record<OrderLanguage, InscriptionStyle> = {
  ja: 'kyujitai',
  'zh-Hans': 'traditional',
  'zh-Hant': 'traditional',
}

export interface GlyphSource {
  kanji: string
  inscription_form: string | null
}

/** The character to carve. With no distinct old/traditional form, both choices give `kanji`. */
export function glyphFor(candidate: GlyphSource, style: InscriptionStyle): string {
  return style === 'kyujitai' || style === 'traditional' ? (candidate.inscription_form ?? candidate.kanji) : candidate.kanji
}

/** Is there a real choice to make for this candidate? (If not, the form hides the question.) */
export const hasDistinctForm = (c: GlyphSource): boolean => c.inscription_form !== null && c.inscription_form !== c.kanji
