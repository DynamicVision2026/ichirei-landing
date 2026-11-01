// The gaze line (spec v9.4): the card prints 「その人は、」 (這個人是 / They are) before `one_line_gaze`, so the line must complete it as ONE sentence DESCRIBING THE PERSON —
// a noun phrase, ending on 〜人 or the person (言葉にせず、息子が撮った場所を一人で歩いていた父。). A sentence whose subject is a word, a feeling or a thing
// (「『そうか』という短い一言の中に、父の十年分の想いが詰まっていた。」) is not a line about the person. The prompts ask for the right shape; this module checks it
// and, when a line fails, asks ONE small model call to rewrite the failing lines once. A rewrite that fails the check too is dropped: the original stays.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { callSignal } from './limits.ts'
import type { Candidate, EngineResult, Language } from './contract.ts'

export const GAZE_TIMEOUT_MS = 12_000
export const gazeFixEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_GAZE_FIX ?? '').trim())

// ---- the check ----------------------------------------------------------------------------------------------------------------------------------

const HIRAGANA_END = /[ぁ-ゖ]$/
/** A few nouns that end in hiragana and are fine to end a line on. */
const NOUNISH_END = /(ひと|こと|もの|かた|さん|ちゃん|たち|ども|ひとたち|ふたり|ほう)$/
/** Abstract subjects: a word, a feeling, a memory, a time — followed by が / は / も: the line is about them, not about the person. */
const JA_ABSTRACT_SUBJECT = /(想い|思い|気持ち|愛情|優しさ|やさしさ|言葉|一言|ひとこと|沈黙|時間|日々|年分|記憶|思い出|心)(が|は|も|こそ)/
const ZH_ABSTRACT_SUBJECT = /(心意|心情|情感|愛|話|话|一句|沈默|沉默|時間|时间|歲月|岁月|回憶|回忆|思念)(裡|里|中|都|就|是|在)?(裝|装|藏|充滿|充满|帶|带|寫|写)/
const ZH_ABSTRACT_END = /(心意|心情|情感|感情|思念|想念|愛意|回憶|回忆|沉默|沉默|話語|话语|時光|时光|歲月|岁月)$/u
const EN_ABSTRACT_START = /^(the |a |an )?(silence|words?|feelings?|love|memor(y|ies)|kindness|warmth|hands?|voice|time|years?|smile|look|gesture|habit|thing)\b/i

const strip = (s: string): string => s.trim().replace(/[。.！!？?」』”"’'\s]+$/u, '')

/** Every way the line fails the shape check (empty = it is a sentence about the person). Short English sentences, also the feedback for the rewrite. */
export function gazeIssues(gaze: string, language: Language): string[] {
  const t = strip(gaze)
  if (!t) return ['it is empty']
  const out: string[] = []
  if (language === 'ja') {
    const last = [...t].at(-1) ?? ''
    if (HIRAGANA_END.test(last) && !NOUNISH_END.test(t)) out.push('it ends on a verb or an adjective, not on a noun phrase (it must end on the person, e.g. 〜人 / 〜父)')
    if (JA_ABSTRACT_SUBJECT.test(t)) out.push('its subject is a word, a feeling or a time, not the person')
  } else if (language === 'en') {
    if (EN_ABSTRACT_START.test(t)) out.push('its subject is a word, a feeling or a thing, not the person ("Someone who…")')
    if (!/\b(who|whose)\b/i.test(t) || !/^(someone|somebody|one|the one|he|she|they|a |an |my |our |the )/i.test(t)) out.push('it does not describe the person ("Someone who…", "A father who…")')
  } else {
    if (/[了著着過过呢吧啊嗎吗]$/u.test(t)) out.push('it ends on a verb or a particle, not on a noun phrase (…的人 / …的父親)')
    if (ZH_ABSTRACT_SUBJECT.test(t) || ZH_ABSTRACT_END.test(t)) out.push('its subject is a word or a feeling, not the person')
    if (!t.includes('的')) out.push('it is not a noun phrase about the person (…的人 / …的父親)')
  }
  return out
}

// Words that state a fact about the SENDER (or a relative) which the story and the form do not give: the form gives the receiver's relationship ("father"), never the sender's
// gender, age or family role. A line that uses one of these when the story itself does not is an invented fact (a `truth` failure) and is rewritten once.
const INVENTED_TERMS: Record<'ja' | 'zh' | 'en', RegExp> = {
  ja: /娘|息子|長男|長女|次男|次女|孫|嫁|婿|姪|甥/u,
  zh: /女儿|女兒|儿子|兒子|长子|長子|长女|長女|孙子|孫子|孙女|孫女|外孙|外孫/u,
  en: /\b(daughter|daughters|son|sons|grandson|granddaughter|grandchild|grandchildren|nephew|niece)\b/i,
}

/** The words in `gaze` that state a sender/relative fact the story does not state. [] = none. */
export function inventedFacts(gaze: string, story: string, language: Language): string[] {
  const re = INVENTED_TERMS[language === 'ja' ? 'ja' : language === 'en' ? 'en' : 'zh']
  const found = new Set<string>()
  for (const m of gaze.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))) {
    const term = m[0]
    if (!story.toLowerCase().includes(term.toLowerCase())) found.add(term)
  }
  return [...found]
}

export const inventedWhy = (terms: string[]): string => `it states a fact about the sender or a relative that the story does not give (${terms.join(', ')}): the form gives the receiver's relationship, never the sender's gender, age or family role. Use 「私」 or neutral wording`

/** null = the line is a sentence about the person; otherwise the first reason it is not. */
export function gazeProblem(gaze: string, language: Language): string | null {
  return gazeIssues(gaze, language)[0] ?? null
}

// ---- the rewrite --------------------------------------------------------------------------------------------------------------------------------

function readPrompt(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of [process.env.ICHIREI_GAZE_PROMPT_PATH, join(here, 'gaze-fix-prompt.md'), join(process.cwd(), 'engine', 'gaze-fix-prompt.md')]) {
    if (!p) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('gaze-fix-prompt.md not found')
}

export const failingGazes = (cands: Candidate[], language: Language, story?: string): { kanji: string; gaze: string; why: string }[] =>
  cands.flatMap((c) => {
    if (c.eliminated || !c.one_line_gaze) return []
    const invented = story !== undefined ? inventedFacts(c.one_line_gaze, story, language) : []
    const why = invented.length > 0 ? inventedWhy(invented) : gazeProblem(c.one_line_gaze, language)
    return why ? [{ kanji: c.kanji, gaze: c.one_line_gaze, why }] : []
  })

function parseJson(raw: string): Record<string, unknown> | null {
  let text = raw.trim()
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = text.indexOf('{')
  const b = text.lastIndexOf('}')
  if (a === -1 || b < a) return null
  try {
    return JSON.parse(text.slice(a, b + 1)) as Record<string, unknown>
  } catch {
    return null
  }
}

export interface GazeFixOptions {
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (u: { model: string; input_tokens: number; output_tokens: number }) => void
}

/** Rewrite the failing lines once. Returns kanji → new line for the rewrites that pass the check; never throws. */
export async function fixGazes(cands: Candidate[], story: string, language: Language, opts: GazeFixOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const log = opts.log ?? ((l: string) => console.log(l))
  const bad = failingGazes(cands, language, story)
  if (bad.length === 0 || !gazeFixEnabled()) return out
  const t0 = Date.now()
  const signal = callSignal(opts.signal, GAZE_TIMEOUT_MS)
  try {
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const items = bad.map((b, i) => `${i + 1}. ${b.kanji}\n   line: ${b.gaze}\n   failed because: ${b.why}`).join('\n')
    const prompt = readPrompt().replace(/\{\{ (LANGUAGE|STORY|ITEMS) \}\}/g, (_m, k: string) => ({ LANGUAGE: language, STORY: story, ITEMS: items })[k] ?? '')
    const model = process.env.ICHIREI_GAZE_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? 'claude-haiku-5-5'
    const stream = client.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    opts.onUsage?.({ model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
    const list = Array.isArray(raw?.gazes) ? (raw!.gazes as { kanji?: unknown; one_line_gaze?: unknown }[]) : []
    let improved = 0
    for (const b of bad) {
      const hit = list.find((x) => x.kanji === b.kanji)
      const next = typeof hit?.one_line_gaze === 'string' ? hit.one_line_gaze.trim() : ''
      if (!next || next === b.gaze || [...next].length > [...b.gaze].length + 24) continue
      // (an invented sender/relative fact counts as a failed check, so a rewrite that removes it is better than the original and one that keeps it is not)
      const before = gazeIssues(b.gaze, language).length + inventedFacts(b.gaze, story, language).length
      const after = gazeIssues(next, language).length + inventedFacts(next, story, language).length
      // The better of the two lines: a rewrite that passes is taken; one that still fails is taken only when it fails FEWER checks than the original; otherwise the original
      // stays. Either way the character keeps its card: a line is never a reason to drop a character.
      if (after === 0 || after < before) {
        out.set(b.kanji, next)
        if (after > 0) improved++
      }
    }
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'gaze_rewritten', failing: bad.length, fixed: out.size - improved, improved, ms: Date.now() - t0 })}`)
  } catch {
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'gaze_rewrite_failed', failing: bad.length, ms: Date.now() - t0 })}`)
  }
  return out
}

export interface LineRewriteOptions extends GazeFixOptions {
  /** The model for the rewrite (default: the small review-class model). */
  model?: string
  /** The ceiling for the call, in ms (default GAZE_TIMEOUT_MS). */
  timeoutMs?: number
}

/**
 * Rewrite named lines ONCE (the free-pick rescue: the review rejected a refilled free pick only because its line claimed something the story does not state). Returns kanji → a new line
 * that passes the shape check, differs from the old one and is not much longer; never throws; an empty map when nothing usable came back.
 */
export async function rewriteLines(items: { kanji: string; gaze: string; why: string }[], story: string, language: Language, opts: LineRewriteOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (items.length === 0 || !gazeFixEnabled()) return out
  const log = opts.log ?? ((l: string) => console.log(l))
  const t0 = Date.now()
  try {
    const signal = callSignal(opts.signal, opts.timeoutMs ?? GAZE_TIMEOUT_MS)
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const listed = items.map((b, i) => `${i + 1}. ${b.kanji}\n   line: ${b.gaze}\n   failed because: ${b.why}`).join('\n')
    const prompt = readPrompt().replace(/\{\{ (LANGUAGE|STORY|ITEMS) \}\}/g, (_m, k: string) => ({ LANGUAGE: language, STORY: story, ITEMS: listed })[k] ?? '')
    const model = opts.model ?? process.env.ICHIREI_GAZE_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? 'claude-haiku-5-5'
    const stream = client.messages.stream({ model, max_tokens: 1500, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal })
    const message = await stream.finalMessage()
    opts.onUsage?.({ model, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
    const list = Array.isArray(raw?.gazes) ? (raw!.gazes as { kanji?: unknown; one_line_gaze?: unknown }[]) : []
    for (const b of items) {
      const hit = list.find((x) => x.kanji === b.kanji)
      const next = typeof hit?.one_line_gaze === 'string' ? hit.one_line_gaze.trim() : ''
      if (next && next !== b.gaze && gazeIssues(next, language).length === 0 && inventedFacts(next, story, language).length === 0 && [...next].length <= [...b.gaze].length + 24) out.set(b.kanji, next)
    }
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'line_rewritten', asked: items.length, fixed: out.size, ms: Date.now() - t0 })}`)
  } catch {
    log(`[ichirei-gaze] ${JSON.stringify({ event: 'line_rewrite_failed', asked: items.length, ms: Date.now() - t0 })}`)
  }
  return out
}

export function applyGazes(result: EngineResult, fixes: Map<string, string>): EngineResult {
  if (fixes.size === 0) return result
  return { ...result, candidates: result.candidates.map((c) => (fixes.has(c.kanji) ? { ...c, one_line_gaze: fixes.get(c.kanji)! } : c)) }
}
