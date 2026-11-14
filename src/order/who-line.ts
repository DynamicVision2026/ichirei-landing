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

/** English: a line that begins "Someone who…", "Someone whose…" or "The one who…" already reads as a whole sentence, so the "They are" label is left off. */
const EN_STANDS_ALONE = /^\s*(?:someone\s+who(?:se)?|the\s+one\s+who)\b/i

/**
 * English card line with its label (2026-11-14): `{ label: false, text }` = show the line alone (it starts "Someone who…" / "Someone whose…" / "The one who…");
 * `{ label: true, text }` = show "They are" and then the text, whose first letter is lowercased ("They are always at the door."). Other languages: the label and
 * the line as before (the label is always shown; the matching opening is taken off).
 */
export function enWhoPart(line: string): { label: boolean; text: string } {
  const raw = String(line ?? '').trim()
  if (EN_STANDS_ALONE.test(raw)) return { label: false, text: raw }
  const rest = raw.replace(/^\s*(?:this person is|they are)\b[,:]?\s*/i, '')
  const text = rest.trim() === '' ? raw : rest
  return { label: true, text: text.charAt(0).toLowerCase() + text.slice(1) }
}
