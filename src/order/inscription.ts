// Which glyph is carved, given the language and the sender's choice on the order form (spec v9.1 step 9: the BUYER'S LOCAL FORM).
//   ja, en:  the modern Japanese form (新字体: 温 静 灯) — no choice; the old 'kyujitai' value is still understood and means 'modern'
//   zh-*:    traditional (the brand standard) or simplified
// The engine's candidate holds `kanji` (ja: modern; zh: SIMPLIFIED) and `inscription_form`
// (ja and en: kyūjitai, no longer carved; zh: TRADITIONAL; null when there is no distinct form).
// Plain TS, no imports: shared by the browser and the server.

export type OrderLanguage = 'ja' | 'zh-Hans' | 'zh-Hant' | 'en'
export type InscriptionStyle = 'kyujitai' | 'modern' | 'traditional' | 'simplified'

export const STYLES_BY_LANGUAGE: Record<OrderLanguage, readonly InscriptionStyle[]> = {
  ja: ['modern'],
  en: ['modern'], // the character is Japanese, carved in Japan in the modern form
  'zh-Hans': ['traditional', 'simplified'],
  'zh-Hant': ['traditional', 'simplified'],
}

/** The brand-standard choice for a language (what the form pre-selects). */
export const DEFAULT_STYLE: Record<OrderLanguage, InscriptionStyle> = {
  ja: 'modern',
  en: 'modern',
  'zh-Hans': 'traditional',
  'zh-Hant': 'traditional',
}

export interface GlyphSource {
  kanji: string
  inscription_form: string | null
}

/**
 * The other form of a character, or null when there is none. A form is real only when it is ONE Han character that differs from `kanji`: a model that says "same" (or "none", "null", "-", the
 * same character again, an empty string) means there is no other form, and that word must never reach a customer or a carving (hotfix 2026-11-05: 惜 showed the word "same").
 */
export function cleanInscriptionForm(kanji: string, form: unknown): string | null {
  if (typeof form !== 'string') return null
  const f = form.normalize('NFC').trim()
  if ([...f].length !== 1 || !/\p{Script=Han}/u.test(f) || f === kanji.normalize('NFC').trim()) return null
  return f
}

/** The character to carve. With no distinct old/traditional form, both choices give `kanji`. */
export function glyphFor(candidate: GlyphSource, style: InscriptionStyle): string {
  return style === 'kyujitai' || style === 'traditional' ? (cleanInscriptionForm(candidate.kanji, candidate.inscription_form) ?? candidate.kanji) : candidate.kanji
}

/** Is there a real choice to make for this candidate? (If not, the form hides the question.) */
export const hasDistinctForm = (c: GlyphSource): boolean => cleanInscriptionForm(c.kanji, c.inscription_form) !== null

/** Is there a choice of form to show for this language and candidate? (ja and en have one form only.) */
export const hasFormChoice = (language: OrderLanguage, c: GlyphSource): boolean => STYLES_BY_LANGUAGE[language].length > 1 && hasDistinctForm(c)

/** Old clients (and old orders) sent 'kyujitai' for ja/en: it now means the modern form. */
export const normalizeStyle = (language: OrderLanguage, style: string): string => ((language === 'ja' || language === 'en') && style === 'kyujitai' ? 'modern' : style)
