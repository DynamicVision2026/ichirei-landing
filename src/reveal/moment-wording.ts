// "Story" becomes "moment" on the landing (2026-11-14): the sender writes ONE MOMENT, not a story. The package descriptions are shared with the order step (which keeps its words), so the landing
// swaps the few words that name the film and the scroll here, on its own copy. Pure text: no React, so a Node test can load it.

import type { RevealLang } from './copy.ts'

const SWAPS: Record<RevealLang, readonly (readonly [string, string])[]> = {
  ja: [['物語の映像', 'その場面の映像'], ['物語絵巻', 'その場面の絵巻']],
  'zh-Hant': [['故事影片', '片刻影片'], ['故事長卷', '片刻長卷']],
  en: [['film of your story', 'film of your moment'], ['pictures of your story', 'pictures of your moment']],
}

/** The landing's version of a package description. */
export const momentWording = (text: string, lang: RevealLang): string => SWAPS[lang].reduce((t, [a, b]) => t.split(a).join(b), text)
