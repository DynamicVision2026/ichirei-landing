// The language and the script of every line a customer reads on a card (2026-11-05, Part 1).
//
// Live finding: on a Traditional-Chinese page the 趣字 line came back in Japanese and the 本命 line in Simplified Chinese. The prompts ask for the right language; this module CHECKS it
// in code and, for the one case that can be mended without the model, mends it with OpenCC (the Simplified → Traditional map, the Taiwan variant with phrases for zh-Hant):
//
//   zh-Hant page   a line with kana is wrong (→ rewrite); a line with Simplified-only characters is converted (OpenCC s2twp)
//   zh-Hans page   a line with kana is wrong (→ rewrite); a line with Traditional-only characters is converted (OpenCC tw2sp)
//   ja page        a line with no kana at all is wrong (→ rewrite)
//   en page        a line with CJK outside quotation marks is wrong (→ rewrite)
//
// The story quote (「あなたの場面」 / 「你的那一刻」) is the customer's own text and is never passed through here.

import * as OpenCC from 'opencc-js'
import type { Language } from './contract.ts'

const simplifiedToTaiwan = OpenCC.Converter({ from: 'cn', to: 'twp' }) // phrases too: 软件 → 軟體 (prose, one card line)
const simplifiedToTaiwanChars = OpenCC.Converter({ from: 'cn', to: 'tw' }) // characters only: the same length in, the same length out (poems, detection)
const taiwanToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' })
const taiwanToSimplifiedPhrases = OpenCC.Converter({ from: 'twp' as never, to: 'cn' }) // (falls back below if this preset is not known)

const KANA = /[぀-ゟ゠-ヿｦ-ﾟ]/u
const HAN = /\p{Script=Han}/u

/**
 * Characters that look "Simplified" to the character map but are ordinary Traditional characters too (皇后, 里長, 范, 征服, 批准, 于 …): they never make a Traditional line wrong.
 * (OpenCC's character map would send them to a rarer character: 后 → 後 inside 皇后 would be a mistake.)
 */
const SHARED = new Set([...'并凶岩恒占干台后于余云咸里范征准冲才面只松秋回向制周谷床吃峰唇斗志系'])

export const hasKana = (s: string): boolean => KANA.test(s)

/** The characters of `s` that exist only in Simplified Chinese (a Traditional line must not have any). */
export function simplifiedOnlyChars(s: string): string[] {
  const out = new Set<string>()
  for (const c of s) if (HAN.test(c) && !SHARED.has(c) && simplifiedToTaiwanChars(c) !== c) out.add(c)
  return [...out]
}

/** The characters of `s` that exist only in Traditional Chinese (a Simplified line must not have any). */
export function traditionalOnlyChars(s: string): string[] {
  const out = new Set<string>()
  for (const c of s) if (HAN.test(c) && !SHARED.has(c) && taiwanToSimplified(c) !== c) out.add(c)
  return [...out]
}

/** Text outside quotation marks (「」『』“” "" ‘’): the only place a CJK word may stand in an English line. */
const outsideQuotes = (s: string): string => s.replace(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"|‘[^’]*’/gu, '')

/** Simplified → Traditional (Taiwan, with phrases): a whole line of prose. */
export const toTraditional = (s: string): string => simplifiedToTaiwan(s)
/** Simplified → Traditional, character by character: the length never changes (a poem line). */
export const toTraditionalChars = (s: string): string => simplifiedToTaiwanChars(s)
/** Traditional → Simplified. */
export const toSimplified = (s: string): string => {
  try {
    return taiwanToSimplifiedPhrases(s)
  } catch {
    return taiwanToSimplified(s)
  }
}

export type LineLanguageCode = 'kana' | 'simplified' | 'traditional' | 'no_kana' | 'cjk'
export interface LineLanguageProblem {
  code: LineLanguageCode
  /** convert = OpenCC can mend it; rewrite = only a new line in the right language will do */
  fix: 'convert' | 'rewrite'
  /** A sentence for the rewrite ("write it in Traditional Chinese, no kana"). */
  message: string
}

/** null = the line is in the page's language and script. */
export function lineLanguageProblem(line: string, language: Language): LineLanguageProblem | null {
  const t = line.normalize('NFC')
  if (!t.trim()) return null
  if (language === 'ja') {
    return hasKana(t) ? null : { code: 'no_kana', fix: 'rewrite', message: 'it is not Japanese: it has no kana at all — write it in natural Japanese (kanji and kana)' }
  }
  if (language === 'en') {
    return HAN.test(outsideQuotes(t)) || KANA.test(outsideQuotes(t)) ? { code: 'cjk', fix: 'rewrite', message: 'it has Chinese or Japanese characters outside quotation marks — write it in plain English' } : null
  }
  if (hasKana(t)) return { code: 'kana', fix: 'rewrite', message: `it has Japanese kana — write it in ${language === 'zh-Hant' ? 'Traditional' : 'Simplified'} Chinese only, no Japanese` }
  if (language === 'zh-Hant') {
    const bad = simplifiedOnlyChars(t)
    return bad.length > 0 ? { code: 'simplified', fix: 'convert', message: `it has Simplified Chinese characters (${bad.slice(0, 6).join('')}) — write it in Traditional Chinese only` } : null
  }
  const bad = traditionalOnlyChars(t)
  return bad.length > 0 ? { code: 'traditional', fix: 'convert', message: `it has Traditional Chinese characters (${bad.slice(0, 6).join('')}) — write it in Simplified Chinese only` } : null
}

/**
 * Rescue order, step 1 (no model): a line whose ONLY fault is the Chinese script is converted. Returns the line to use, or null when the line cannot be mended this way
 * (kana / no kana / CJK in English, or the conversion did not make it right).
 */
export function convertLineScript(line: string, language: Language): string | null {
  const problem = lineLanguageProblem(line, language)
  if (!problem || problem.fix !== 'convert') return null
  const next = language === 'zh-Hant' ? toTraditional(line) : toSimplified(line)
  return next !== line && lineLanguageProblem(next, language) === null ? next : null
}

/** Is this a line that carries the right language already, or can be made so by conversion alone? */
export const lineLanguageOk = (line: string, language: Language): boolean => lineLanguageProblem(line, language) === null || convertLineScript(line, language) !== null

// ---- the gate for a card (used by the parallel cards, the refill and the engine's last gate) ----------------------------------------------------------------------------------------

export const LANGUAGE_REASON = 'language: the line is not in the page\'s language and script'

export type LanguageHow = 'ok' | 'converted' | 'rewritten' | 'dropped'
export interface LanguageOutcome {
  how: LanguageHow
  /** the code of the problem found first (null when the line was fine) */
  code: LineLanguageCode | null
  /** the line to use (the card is dropped when how = dropped) */
  line: string
}

/**
 * The rescue order for one line: (1) fine → as it is; (2) only the Chinese script is wrong → convert with OpenCC; (3) otherwise ONE rewrite in the right language by `rewrite`
 * (a function the caller supplies; it returns the new line or null); the result is checked again and converted if needed; (4) still wrong → dropped (the caller uses the slot's normal refill).
 */
export async function ensureLineLanguage(line: string, language: Language, rewrite?: (why: string) => Promise<string | null>): Promise<LanguageOutcome> {
  const problem = lineLanguageProblem(line, language)
  if (!problem) return { how: 'ok', code: null, line: fullWidthPunctuation(line, language) }
  const converted = convertLineScript(line, language)
  if (converted !== null) return { how: 'converted', code: problem.code, line: fullWidthPunctuation(converted, language) }
  if (rewrite) {
    const next = await rewrite(problem.message)
    if (next) {
      if (lineLanguageProblem(next, language) === null) return { how: 'rewritten', code: problem.code, line: fullWidthPunctuation(next, language) }
      const again = convertLineScript(next, language)
      if (again !== null) return { how: 'rewritten', code: problem.code, line: fullWidthPunctuation(again, language) }
    }
  }
  return { how: 'dropped', code: problem.code, line }
}

// ---- captions (the film): the same rule, but the customer's own quoted words are left exactly as written ---------------------------------------------------------------------------

const QUOTE_SPLIT = /(「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*")/u

/** A caption line judged by the text OUTSIDE its quotation marks (a quotation is the customer's own word-for-word text and is never checked or converted). */
export function captionLanguageProblem(line: string, language: Language): LineLanguageProblem | null {
  const bare = line.split(QUOTE_SPLIT).filter((_, i) => i % 2 === 0).join('').trim()
  if (!bare) return null
  return lineLanguageProblem(bare, language)
}

/** The Chinese script of a caption converted outside its quotation marks (OpenCC). null = nothing to convert, or the conversion would not make it right. */
export function convertCaptionScript(line: string, language: Language): string | null {
  if (language !== 'zh-Hant' && language !== 'zh-Hans') return null
  const parts = line.split(QUOTE_SPLIT)
  const next = parts.map((p, i) => (i % 2 === 0 ? (language === 'zh-Hant' ? toTraditional(p) : toSimplified(p)) : p)).join('')
  return next !== line && captionLanguageProblem(next, language) === null ? fullWidthPunctuation(next, language) : null
}

// ---- poems --------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const taiwanToSimplifiedChars = OpenCC.Converter({ from: 'tw', to: 'cn' })

/**
 * The lines of a CHINESE poem (tang / ci) for a Chinese-reading buyer: the script is converted character by character (the length never changes, so the form and the rhyme checks still hold);
 * a line with kana is a problem (the poem is written again). Other poems (the Japanese ones, the English one) are not touched.
 */
export function poemLinesForLanguage(lines: string[], type: string, language: Language): { lines: string[]; problem: string | null } {
  if ((type !== 'tang' && type !== 'ci') || (language !== 'zh-Hant' && language !== 'zh-Hans')) return { lines, problem: null }
  if (lines.some((l) => hasKana(l))) return { lines, problem: 'a line has Japanese kana: write the poem in Chinese only' }
  return { lines: lines.map((l) => fullWidthPunctuation(language === 'zh-Hant' ? toTraditionalChars(l) : taiwanToSimplifiedChars(l), language)), problem: null }
}

// ---- punctuation (hotfix 2026-11-05) -------------------------------------------------------------------------------------------------------------------------------------------------

const HALF_TO_FULL: Record<string, string> = { ',': '，', ';': '；', ':': '：', '?': '？', '!': '！' }
const CJK_BEFORE = /[\p{Script=Han}\u3000-\u303f\uff00-\uffef]$/u
const CJK_AFTER = /^\s*(?:[\p{Script=Han}\u3000-\u303f\uff00-\uffef]|$)/u

/**
 * On a Chinese page a half-width , ; : ? ! that sits after a CJK character and before a CJK character (or the end of the line) becomes the full-width mark (，；：？！). The customer's own quotations
 * (inside 「」 『』 “” "") are left exactly as written. Other languages are not touched.
 */
export function fullWidthPunctuation(text: string, language: Language): string {
  if (language !== 'zh-Hant' && language !== 'zh-Hans') return text
  const quoted: [number, number][] = []
  for (const m of text.matchAll(/「[^」]*」|『[^』]*』|“[^”]*”|"[^"]*"/gu)) quoted.push([m.index, m.index + m[0].length])
  const inQuote = (k: number) => quoted.some(([a, b]) => k >= a && k < b)
  let out = ''
  for (let k = 0; k < text.length; k++) {
    const ch = text[k]
    const full = HALF_TO_FULL[ch]
    out += full && !inQuote(k) && CJK_BEFORE.test(text.slice(0, k)) && CJK_AFTER.test(text.slice(k + 1)) ? full : ch
  }
  return out
}
