// The language a moment is written in (2026-11-20, Part 6). The story's language is the one key that decides the gift — the character and its meaning, the reading, the line, the poem forms, the pictures'
// world and the receiver's ceremony; the page's language decides only the menus, buttons, prices, currency and checkout. Plain TS, no data files: the pages and the server share it. The server decides
// once, when a round starts (engine/story-language.ts adds the Traditional / Simplified split).

export type StoryLanguage = 'ja' | 'zh' | 'en'

/** The language most of the story's text is written in (kana → Japanese; else Han characters → Chinese; else Latin letters → English), or null when it is too short to tell. */
export function detectStoryLanguage(text: string): StoryLanguage | null {
  let kana = 0
  let han = 0
  let latin = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x3040 && c <= 0x30ff) || c === 0x30fc) kana++
    else if ((c >= 0x3400 && c <= 0x9fff) || (c >= 0xf900 && c <= 0xfaff)) han++
    else if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a)) latin++
  }
  const total = kana + han + latin
  if (total < 8) return null
  // Japanese prose is full of kana (about half of its letters); Chinese has none
  if (kana / total >= 0.12) return 'ja'
  if (han >= latin) return 'zh'
  return 'en'
}

