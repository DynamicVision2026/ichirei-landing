// The "who they are" line (spec v9.4) completes a label — ja 「その人は、」 / zh 這個人是 / en "They are" (the card preview) or どんな人か / 對方是怎樣的人 / What they're like (the cards).
// A model sometimes begins the line with that wording itself, and the page then shows it twice ("這個人是 這個人是會把你穩穩領回原處的人。", 2026-11-07).
// Where the label is shown, the matching opening is taken off the line when it is DISPLAYED (the stored line is never changed). Where there is no label, the line is shown as written.

import type { Language } from '../../engine/contract.ts'

/** Openings that repeat the label, longest first. The Simplified forms are the same words (zh-Hans); a following comma is part of the opening. */
const OPENINGS: Record<'ja' | 'zh' | 'en', RegExp> = {
  ja: /^\s*その人は[、,，]?\s*/,
  zh: /^\s*(?:這個人是|这个人是|那個人是|那个人是|這個人|这个人|他是|她是)[，,、]?\s*/,
  en: /^\s*(?:this person is|they are|someone who)\b[,:]?\s*/i,
}

const familyOf = (language: Language | string): 'ja' | 'zh' | 'en' => (language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh')

/**
 * The line without an opening that repeats the label. Only one opening is removed. A line that is nothing but the opening is returned as it was
 * (never an empty line).
 */
export function stripWhoOpening(line: string, language: Language | string): string {
  const text = String(line ?? '')
  const rest = text.replace(OPENINGS[familyOf(language)], '')
  return rest.trim() === '' ? text : rest
}

/** `labelShown` false: the line stands alone (a gift page or a print file without the label) and keeps its opening. */
export const whoLine = (line: string, language: Language | string, labelShown: boolean): string => (labelShown ? stripWhoOpening(line, language) : line)
