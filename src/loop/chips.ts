// The two small chips of a saved gift — the relationship and the reason — in the page's language (Part 17, 2026-11-20).
// A chip that only says "Other" / 「その他」 / 「其他」 tells nobody anything: it shows the customer's own words when they typed some
// (`relationship_other`; `purpose_other`, else `occasion_detail`), and is left out when they did not. With both left out there is no chip row at all.
// Pure: no React, no network — shared by every page that shows a gift's context.

import { COPY, type UiLanguage } from '../demo/i18n.ts'
import { PURPOSE_COPY } from '../demo/purpose-copy.ts'

export interface ChipContext {
  relationship: string
  relationship_other?: string
  purpose: string
  purpose_other?: string
  occasion?: string
  occasion_detail?: string
}

/** The words that say nothing: "Other", 「その他」, 「其他」 (and the same in simplified), with any punctuation or width variant around them. */
const EMPTY_WORDS = /^[\s・.。…\-–—()（）「」『』"'“”]*(other|others|その他|そのほか|其他|其它|其餘|其余|etc\.?)[\s・.。…\-–—()（）「」『』"'“”]*$/i
export const isMeaninglessChip = (t: string | null | undefined): boolean => !t || t.trim() === '' || EMPTY_WORDS.test(t.trim())

/** "お祝い（誕生日・還暦…）" → "お祝い": a chip says the reason, not its examples. */
const short = (label: string): string => label.replace(/[（(].*$/, '').trim()

export function contextChips(x: ChipContext | null | undefined, lang: UiLanguage): string[] {
  if (!x) return []
  const out: string[] = []
  const rels = COPY[lang].relationships as Record<string, string>
  const rel = x.relationship === 'other' ? (x.relationship_other ?? '') : (rels[x.relationship] ?? '')
  if (!isMeaninglessChip(rel)) out.push(short(rel))
  const purposes = PURPOSE_COPY[lang].purposes as Record<string, string>
  const why = x.purpose === 'other' ? (x.purpose_other || x.occasion_detail || '') : (purposes[x.purpose] ?? '')
  if (!isMeaninglessChip(why)) out.push(short(why))
  return out
}
