// The story's language, decided ONCE on the server when a round starts (Part 6, 2026-11-20), and the same answer at every later step (preview, poem, order) because it is computed from the same text.
//
//   - kana → Japanese; Han characters alone → Chinese; Latin letters → English: the language MOST of the story is written in (a mixed story follows its larger part)
//   - Chinese: Traditional or Simplified follows the story's own characters (OpenCC tells them apart); a tie or no sign keeps the page's Chinese, else Traditional
//   - too short to tell (fewer than 8 letters): the page's language
// The page language is never asked for anything else here: it only breaks ties and fills in when the text says nothing.

import { detectStoryLanguage } from '../src/order/story-language.ts'
import { simplifiedOnlyChars, traditionalOnlyChars } from './script.ts'
import type { Language } from './contract.ts'

export function decideStoryLanguage(text: string, page: Language): Language {
  const family = detectStoryLanguage(text)
  if (family === null) return page
  if (family === 'ja') return 'ja'
  if (family === 'en') return 'en'
  const simp = simplifiedOnlyChars(text).length
  const trad = traditionalOnlyChars(text).length
  if (simp > trad) return 'zh-Hans'
  if (trad > simp) return 'zh-Hant'
  return page === 'zh-Hans' || page === 'zh-Hant' ? page : 'zh-Hant'
}
