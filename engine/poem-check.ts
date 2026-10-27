// The poem add-on's CODE checks (the writing itself lives in engine/poem.<type>.md). Pure functions, no model: they count, compare and look
// characters up. A poem that fails any of them is a form error, exactly like a wrong syllable count.
//
//   tanka  5 lines of 5-7-5-7-7 morae, counted from the kana reading the model returns
//   tang   4 lines, all 5 or all 7 characters, traditional characters
//   ci     one of three patterns only (憶江南 3-5-7-7-5, 如夢令 6-6-5-6-2-2-6, 長相思 3-3-7-5 ×2), line lengths of the chosen pattern
//   en     4–6 short lines of free verse
//   all    the chosen character (or its traditional / modern variant) appears in the poem; no character that the palette blocks for this
//          gift (level 1 hard blocks, level 3 occasion blocks, the remembrance default block); no death / decline / parting words in English
//          when the occasion forbids them

import type { PoemType } from '../src/order/packages.ts'
import type { Occasion } from './contract.ts'
import type { Palette } from './palette.ts'

export interface PoemDraft {
  type: PoemType
  lines: string[]
  /** tanka: the kana reading of each line (the mora count is taken from it). */
  reading_kana?: string[]
  /** ci: the pattern name. */
  pattern?: string
}

export const CI_PATTERNS: Record<string, number[]> = {
  憶江南: [3, 5, 7, 7, 5],
  如夢令: [6, 6, 5, 6, 2, 2, 6],
  長相思: [3, 3, 7, 5, 3, 3, 7, 5],
}
export const TANKA_MORAE = [5, 7, 5, 7, 7]
export const EN_MAX_WORDS_PER_LINE = 12

const PUNCT = /[\s　、。，．,.;；:：!！?？「」『』（）()〔〕［］[\]・〜~…—–-]/gu
const SMALL_KANA = new Set([...'ゃゅょぁぃぅぇぉゎ'])

/** Hiragana, katakana → hiragana; everything else unchanged. */
const toHiragana = (s: string) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))

/** Morae of a kana string: every kana is one mora, except the small ゃゅょ (and small ぁぃぅぇぉゎ), which join the kana before them. ッ and ー count 1. */
export function moraCount(kana: string): number {
  let n = 0
  for (const ch of toHiragana(kana.replace(PUNCT, ''))) if (!SMALL_KANA.has(ch)) n++
  return n
}

/** Is this a kana-only string (hiragana, katakana, ー, ー-like marks, spaces and punctuation)? */
export const isKanaOnly = (s: string): boolean => /^[ぁ-ゖァ-ヶーー・・\s、。，,.!！?？「」]*$/u.test(s)

/** Characters of a line, punctuation and spaces dropped. */
export const hanCount = (line: string): number => [...line.replace(PUNCT, '')].length

/** Common simplified-only characters (the palette's simplified forms are added at check time): a tang / ci poem is written in traditional characters. */
const SIMPLIFIED_COMMON = [...'个们这说话时国学会对发过还没为来样种经开关长门东车见书马鸟鱼风间头题亲爱叶问听读谁让认识气岁难饭饮飞丰业买卖写请谢难欢乐实应从众优伤乱产习划画协华压厂历参双变号叹团园图圆坏块场处声备复够头夺奋妇孙宽审宁尽层岛带师帮广庆开归当录彻忆忧怀态总恋恶惊战户扑执扩扬摆数断无旧显晓术机杀杂条标样欢点烛灯热爷牵猎献环现电画盖盘笔签纸线练组细织终经结绝统继续维绿缘缝罗职联脑脸艺节苏药虽蚕见观规视览觉计订认讨让训议记讲许论设访证评识诉词译试诗话该详语误说请诸诺读课谁调谈谊谋谢谨豆贝负财责贤败账货质购贯贵买费贺资赏赖赠赵跃车轮软转轻载较辅辈输辞边达迁过运远连迟选递遗邻郑酿释针钓钟钢钱铁铃银锁错键镇长门闪闭问间闲闹闻阅阳阴阵阶际陆陈险随隐难雏页顶项顺须顾顿颁预领颇频颗题颜额风飘饭饮饱饼馆首驱驶驻驾骂骄骑验骗鱼鲜鸡鸣麦黄齐齿龄龙龟']

/** Simplified-only characters the zh palette knows (its `kanji` where a distinct traditional `inscription_form` exists). */
function simplifiedSet(palette: Palette): Set<string> {
  const out = new Set(SIMPLIFIED_COMMON)
  for (const r of palette.rows) if (r.language === 'zh' && r.inscription_form && r.inscription_form !== r.kanji) out.add(r.kanji)
  return out
}

/** Form problems of a draft, empty when it is well formed. */
export function checkForm(d: PoemDraft, palette?: Palette): string[] {
  const p: string[] = []
  const lines = d.lines
  if (!Array.isArray(lines) || lines.some((l) => typeof l !== 'string' || l.trim() === '')) return ['the poem has an empty or missing line']
  switch (d.type) {
    case 'tanka': {
      if (lines.length !== 5) p.push(`a tanka has 5 lines (got ${lines.length})`)
      const kana = d.reading_kana
      if (!Array.isArray(kana) || kana.length !== lines.length) {
        p.push('the kana reading must have one entry per line')
        break
      }
      kana.forEach((k, i) => {
        if (!isKanaOnly(k)) p.push(`reading line ${i + 1} is not kana only`)
        const n = moraCount(k)
        if (lines.length === 5 && n !== TANKA_MORAE[i]) p.push(`line ${i + 1} has ${n} morae, expected ${TANKA_MORAE[i]}`)
      })
      break
    }
    case 'tang': {
      if (lines.length !== 4) p.push(`a quatrain has 4 lines (got ${lines.length})`)
      const counts = lines.map(hanCount)
      const first = counts[0]
      if (!(first === 5 || first === 7) || counts.some((c) => c !== first)) p.push(`all lines must have 5 characters or all 7 (got ${counts.join('-')})`)
      break
    }
    case 'ci': {
      const pattern = CI_PATTERNS[d.pattern ?? '']
      if (!pattern) {
        p.push(`pattern must be one of ${Object.keys(CI_PATTERNS).join(' / ')}`)
        break
      }
      const counts = lines.map(hanCount)
      if (counts.join('-') !== pattern.join('-')) p.push(`${d.pattern} needs line lengths ${pattern.join('-')} (got ${counts.join('-')})`)
      break
    }
    case 'en': {
      if (lines.length < 4 || lines.length > 6) p.push(`an English poem has 4–6 lines (got ${lines.length})`)
      lines.forEach((l, i) => {
        const words = l.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length
        if (words > EN_MAX_WORDS_PER_LINE) p.push(`line ${i + 1} is not short (${words} words)`)
      })
      break
    }
  }
  if ((d.type === 'tang' || d.type === 'ci') && palette) {
    const simp = simplifiedSet(palette)
    const bad = [...new Set([...lines.join('')].filter((c) => simp.has(c)))]
    if (bad.length > 0) p.push(`written in traditional characters (found simplified: ${bad.join('')})`)
  }
  return p
}

/** The chosen character (in any of its forms) must appear in the poem text. */
export function checkContainsCharacter(d: PoemDraft, forms: string[]): string | null {
  const text = d.lines.join('')
  return forms.filter(Boolean).some((f) => text.includes(f)) ? null : `the chosen character (${forms.filter(Boolean).join(' / ')}) does not appear in the poem`
}

/** English words the occasion forbids (the AI's own rules are in the prompt and the review; this is the cheap backstop). */
const EN_FORBIDDEN: Record<string, RegExp> = {
  memorial: /\b(death|dead|dies?|died|dying|funeral|grave|tomb|heaven|afterlife|passed away|gone forever|loss|lost (her|him|them)|late (mother|father|mum|mom|dad))\b/i,
  birthday_milestone: /\b(old age|elderly|ageing|aging|declin\w*|wither\w*|fading|twilight|winter of (life|age)|too old|growing old)\b/i,
  wedding: /\b(goodbye|farewell|separat\w*|divorc\w*|break ?up|parting|leaving|never again)\b/i,
}

/**
 * Palette problems: a character the palette blocks for this gift — level 1 (hard_block), level 3 (blocked for this occasion), the remembrance
 * default block — anywhere in the poem. `families` are the palettes that judge the poem's script (tanka → ja; tang / ci → zh, and ja for a Japanese
 * buyer). The chosen character itself is exempt (it was already judged when it was offered).
 */
export function checkPalette(d: PoemDraft, palette: Palette, occasion: Occasion | null, families: ('ja' | 'zh')[], exempt: string[] = []): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const ch of [...d.lines.join('')]) {
    if (!/[㐀-鿿豈-﫿]/u.test(ch) || seen.has(ch) || exempt.includes(ch)) continue
    seen.add(ch)
    if (occasion === 'memorial' && palette.memorialCategory([ch])) {
      out.push(`${ch}: blocked in remembrance (${palette.memorialCategory([ch])})`)
      continue
    }
    for (const f of families) {
      const row = palette.lookup(f, ch)
      if (!row) continue
      if (row.status === 'hard_block') out.push(`${ch}: hard block (never used)`)
      else if (occasion && row.blocked_occasions.includes(occasion)) out.push(`${ch}: blocked for ${occasion}`)
      else continue
      break
    }
  }
  const re = occasion ? EN_FORBIDDEN[occasion] : undefined
  if (re && d.type === 'en') {
    const hit = d.lines.join(' ').match(re)
    if (hit) out.push(`"${hit[0]}": not allowed for ${occasion}`)
  }
  return out
}

/** The characters the model is told to avoid for this gift (the palette's level 1 and 3 + the remembrance block), for the prompt. */
export function blockedCharacters(palette: Palette, occasion: Occasion | null, families: ('ja' | 'zh')[]): string[] {
  const out = new Set<string>()
  for (const r of palette.rows) {
    if (!families.includes(r.language)) continue
    if (r.status === 'hard_block' || (occasion && r.blocked_occasions.includes(occasion))) {
      out.add(r.kanji)
      if (r.inscription_form) out.add(r.inscription_form)
    }
  }
  if (occasion === 'memorial') for (const k of palette.memorialBlocked.keys()) out.add(k)
  return [...out]
}
