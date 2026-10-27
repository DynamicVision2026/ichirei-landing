// Rhyme check for the 漢詩 (tang) poem: lines 2 and 4 must end on the same rhyme (line 1 may, and need not). Plumbing only — it looks the
// final syllable of each line up with the `pinyin-pro` library (the whole line is given for context, so a polyphonic character takes the
// reading its line implies) and compares the RHYME GROUP (中華新韻, the 14 modern rhyme groups) of the two. Modern Mandarin groups, not 平水韻:
// the owner asked for a pinyin check. Nothing here writes or judges a poem.

import { pinyin } from 'pinyin-pro'

/** 中華新韻 (the 14 rhyme groups) by final. `ü` finals are written with ü; `ui` = uei, `iu` = iou, `un` = uen. */
const GROUPS: Record<string, string> = {}
const add = (name: string, finals: string) => finals.split(' ').forEach((f) => (GROUPS[f] = name))
add('一麻', 'a ia ua')
add('二波', 'o uo e')
add('三皆', 'ie üe ê')
add('四開', 'ai uai')
add('五微', 'ei uei ui')
add('六豪', 'ao iao')
add('七尤', 'ou iou iu')
add('八寒', 'an ian uan üan')
add('九文', 'en in uen un ün')
add('十唐', 'ang iang uang')
add('十一庚', 'eng ing ong iong ueng')
add('十二齊', 'i ü')
add('十三支', '-i er')
add('十四姑', 'u')

export interface RhymeInfo {
  char: string
  pinyin: string
  final: string
  group: string | null
}

/** The rhyme of the last character of a line (punctuation and spaces ignored). null when the line has no Chinese character at the end. */
export function lineRhyme(line: string): RhymeInfo | null {
  const chars = [...line].filter((c) => /[㐀-鿿豈-﫿]/u.test(c))
  if (chars.length === 0) return null
  const text = chars.join('')
  const syllables = pinyin(text, { type: 'array', toneType: 'none' })
  const initials = pinyin(text, { type: 'array', toneType: 'none', pattern: 'initial' })
  const finals = pinyin(text, { type: 'array', toneType: 'none', pattern: 'final' })
  const i = chars.length - 1
  const initial = initials[i] ?? ''
  let final = finals[i] ?? ''
  if (!final) return { char: chars[i], pinyin: syllables[i] ?? '', final: '', group: null }
  if (initial === 'y' && final === 'e') final = 'ie' // 夜 ye
  if ('jqxy'.includes(initial) && initial !== '' && final.startsWith('u')) final = 'ü' + final.slice(1) // 魚 yu, 雲 yun
  if (final === 'i' && /^(zh|ch|sh|r|z|c|s)$/.test(initial)) final = '-i' // 詩 shi, 思 si
  return { char: chars[i], pinyin: syllables[i] ?? '', final, group: GROUPS[final] ?? null }
}

/** Rhyme problems of a quatrain: lines 2 and 4 must end on the same rhyme group. Empty when they do (or when there are not four lines). */
export function checkRhyme(lines: string[]): string[] {
  if (lines.length !== 4) return []
  const a = lineRhyme(lines[1])
  const b = lineRhyme(lines[3])
  if (!a || !b) return ['lines 2 and 4 must end on a Chinese character']
  if (a.group === null || b.group === null || a.group !== b.group) {
    return [`lines 2 and 4 must rhyme: line 2 ends on ${a.char} (${a.pinyin}) and line 4 on ${b.char} (${b.pinyin}) — they do not share a rhyme`]
  }
  return []
}
