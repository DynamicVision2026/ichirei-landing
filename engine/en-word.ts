// The English word under the character (Ticket 9, 2026-11-26). On an English gift the word is chosen IN ENGLISH, FROM THE MOMENT — it names how the sender sees this person here, and it finishes the
// page's sentence "In {sender}'s eyes, you are ___". It is not the dictionary translation of the kanji ("clemency" for 恕 read as a legal pardon).
//
// One path for every English gift: the model returns `en_word` in the same call that chooses the character; code then checks it here —
//   · a word of the right shape (one or two words), never archaic, never a self-help word, never a legal, medical or religious term, never a word that implies a fault;
//   · a real SENSE of the character: engine/en-senses.csv holds 4–8 plain English senses per character (the first is the natural word used as the fallback);
// a word that fails is asked for ONCE more (a small call that lists the senses); if that fails too, the first sense stands. The settled word travels on the candidate (`en_word`, `en_word_source`) and is
// the only word every English surface shows. Nothing here runs for ja or zh.

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candidate, EngineResult, Language } from './contract.ts'
import { ARCHAIC_WORDS, SELF_HELP_WORDS } from './en-bridge.ts'
import { EN_WORD_SHAPE } from './lexicon-en.ts'
import { usageOf } from './cache-usage.ts'
import { callSignal } from './limits.ts'
import { tracked } from './engine-log.ts'

export const EN_WORD_TIMEOUT_MS = 12_000
/** ICHIREI_ENWORD_FIX=off skips the one retry (the character's first sense stands at once): a rollback switch, and how the suites that pin the engine's call sequence keep it. */
export const enWordRetryEnabled = (env: NodeJS.ProcessEnv = process.env): boolean => !/^(off|0|false|no)$/i.test((env.ICHIREI_ENWORD_FIX ?? '').trim())

// ---- the senses ------------------------------------------------------------------------------------------------------------------------------------------------

const here = dirname(fileURLToPath(import.meta.url))
let cache: Map<string, string[]> | null = null

/** engine/en-senses.csv: `kanji,senses` with the senses joined by `|`, the first one the natural fallback word. */
export function loadSenses(): Map<string, string[]> {
  if (cache) return cache
  let raw = ''
  for (const p of [join(here, 'en-senses.csv'), join(process.cwd(), 'engine', 'en-senses.csv')]) {
    try {
      raw = readFileSync(p, 'utf8')
      break
    } catch {
      // next
    }
  }
  const map = new Map<string, string[]>()
  for (const line of raw.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(',')
    if (i < 1) continue
    const senses = line.slice(i + 1).split('|').map((s) => s.trim().toLowerCase()).filter(Boolean)
    if (senses.length) map.set(line.slice(0, i).trim(), senses)
  }
  cache = map
  return map
}

/** The plain English senses of a candidate's character (by its own form, then its inscription form); null when the character has no entry. */
export function sensesOf(c: Pick<Candidate, 'kanji' | 'inscription_form'>, map: Map<string, string[]> = loadSenses()): string[] | null {
  return map.get(c.kanji) ?? (c.inscription_form ? map.get(c.inscription_form) : undefined) ?? null
}

/** A crude stem, the same on both sides: humble = humbleness, understanding = understand, steadfast = steadfastness. */
export function stemOf(word: string): string {
  let w = word.toLowerCase().replace(/[^a-z]/g, '')
  for (let pass = 0; pass < 2; pass++) {
    for (const suf of ['ness', 'ity', 'ment', 'ing', 'ful', 'ous', 'ive', 'ly', 'ed', 'er', 'al', 'es', 's', 'y', 'e']) {
      if (w.length > suf.length + 3 && w.endsWith(suf)) {
        w = w.slice(0, -suf.length)
        break
      }
    }
  }
  return w
}

/** The word, or one of its two words, is one of the senses (or an inflection of one). */
export function senseMatch(word: string, senses: readonly string[]): boolean {
  const w = word.trim().toLowerCase()
  const stems = new Set(senses.flatMap((s) => [stemOf(s), ...s.split('-').map(stemOf)]))
  if (senses.includes(w)) return true
  return w.split(/[ -]/).filter(Boolean).some((part) => senses.some((s) => s === part) || stems.has(stemOf(part)))
}

// ---- words an English gift never shows -------------------------------------------------------------------------------------------------------------------------

const set = (s: string): ReadonlySet<string> => new Set(s.split(/\s+/).filter(Boolean))
/** Legal terms (a pardon, a verdict). */
export const LEGAL_WORDS = set('clemency clement pardon pardoning pardoned absolve absolved absolution acquit acquitted acquittal amnesty exonerate exonerated exoneration verdict guilty guilt innocent blameless probation sentence lenient leniency mercy merciful')
/** Medical terms. */
export const MEDICAL_WORDS = set('healing healer healthy cure curative remedy therapeutic therapist medicine medicinal doctor diagnosis symptom sane sanity recovery recovered recuperative')
/** Religious terms. */
export const RELIGIOUS_WORDS = set('holy sacred blessed divine devout pious saintly saint angelic heavenly godly prayerful reverent reverence worship salvation redeemed redemption grace faithful sinless spiritual sanctified celestial miraculous prayer pray')
/** Words that imply a fault in the person. */
export const FAULT_WORDS = set('forgive forgiving forgiven forgiveness tolerant tolerating indulgent indulgence stubborn obstinate submissive meek docile timid naive gullible weak helpless resigned indebted apologetic sorry ashamed')

export type ForbiddenKind = 'legal' | 'medical' | 'religious' | 'fault'
export function forbiddenKind(word: string): ForbiddenKind | null {
  for (const part of word.toLowerCase().split(/[ -]/).filter(Boolean)) {
    if (LEGAL_WORDS.has(part)) return 'legal'
    if (MEDICAL_WORDS.has(part)) return 'medical'
    if (RELIGIOUS_WORDS.has(part)) return 'religious'
    if (FAULT_WORDS.has(part)) return 'fault'
  }
  return null
}

/** Why a word may not stand under the character, or null: its shape, archaic or self-help, a forbidden kind, or (when the character's senses are known) not a sense of it. */
export function enWordProblem(raw: unknown, senses: readonly string[] | null): string | null {
  if (typeof raw !== 'string') return 'missing'
  const w = raw.trim().replace(/^["“'‘]+|["”'’.,;:!]+$/g, '').replace(/\s+/g, ' ').toLowerCase()
  if (!w) return 'missing'
  if (!EN_WORD_SHAPE.test(w)) return 'shape'
  for (const part of w.split(/[ -]/)) {
    if (ARCHAIC_WORDS.has(part)) return 'archaic'
    if (SELF_HELP_WORDS.has(part)) return 'self_help'
  }
  const kind = forbiddenKind(w)
  if (kind) return kind
  if (senses && !senseMatch(w, senses)) return 'not_a_sense'
  return null
}

/** The model's word, tidied (quotes, a closing stop, case) — or null when it is empty. */
export const tidyWord = (raw: unknown): string | null => (typeof raw === 'string' && raw.trim() ? raw.trim().replace(/^["“'‘]+|["”'’.,;:!]+$/g, '').replace(/\s+/g, ' ').toLowerCase() : null)

// ---- the one retry ---------------------------------------------------------------------------------------------------------------------------------------------

function readPrompt(): string {
  for (const p of [process.env.ICHIREI_ENWORD_PROMPT_PATH, join(here, 'en-word-prompt.md'), join(process.cwd(), 'engine', 'en-word-prompt.md')]) {
    if (!p) continue
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error('en-word-prompt.md not found')
}

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

export interface EnWordOptions {
  apiKey?: string
  signal?: AbortSignal
  client?: Pick<Anthropic, 'messages'>
  log?: (line: string) => void
  onUsage?: (u: { model: string; input_tokens: number; output_tokens: number }) => void
}

interface Item {
  kanji: string
  line: string
  senses: readonly string[] | null
  word: string
  why: string
}

/** One small call for every word that was not accepted. Returns kanji → a new word (only those that pass the check); never throws. */
export async function retryEnWords(items: Item[], story: string, opts: EnWordOptions = {}): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (items.length === 0 || !enWordRetryEnabled()) return out
  const log = opts.log ?? ((l: string) => console.log(l))
  const t0 = Date.now()
  try {
    const client = opts.client ?? new Anthropic({ maxRetries: 0, ...(opts.apiKey ? { apiKey: opts.apiKey } : {}) })
    const list = items.map((b, i) => `${i + 1}. ${b.kanji}\n   line: ${b.line}\n   senses: ${b.senses ? b.senses.join(', ') : '(choose a plain, natural quality)'}\n   not accepted: "${b.word}" — ${b.why.replace(/_/g, ' ')}`).join('\n')
    const prompt = readPrompt().replace(/\{\{ (STORY|ITEMS) \}\}/g, (_m, k: string) => ({ STORY: story, ITEMS: list })[k] ?? '')
    const model = process.env.ICHIREI_ENWORD_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? 'claude-haiku-5-5'
    const stream = tracked('gaze', client).messages.stream({ model, max_tokens: 800, output_config: { effort: 'low' }, messages: [{ role: 'user', content: prompt }] }, { signal: callSignal(opts.signal, EN_WORD_TIMEOUT_MS) })
    const message = await stream.finalMessage()
    opts.onUsage?.(usageOf(model, message.usage))
    const raw = parseJson(message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join(''))
    const words = Array.isArray(raw?.words) ? (raw!.words as { kanji?: unknown; en_word?: unknown }[]) : []
    for (const b of items) {
      const hit = words.find((x) => x.kanji === b.kanji)
      const next = tidyWord(hit?.en_word)
      if (next && enWordProblem(next, b.senses) === null) out.set(b.kanji, next)
    }
    log(`[ichirei-enword] ${JSON.stringify({ event: 'en_word_retry', asked: items.length, fixed: out.size, ms: Date.now() - t0 })}`)
  } catch {
    log(`[ichirei-enword] ${JSON.stringify({ event: 'en_word_retry_failed', asked: items.length, ms: Date.now() - t0 })}`)
  }
  return out
}

/** The natural word the first sense gives (the fallback). */
export const fallbackWord = (senses: readonly string[] | null): string | null => (senses && senses.length ? senses[0] : null)

const isBridgeSlot = (c: Candidate): boolean => c.slot === 'main' || c.slot === 'second'

/**
 * Settle the English word of every main and second card of an English result: the model's word when it passes the checks, else one retry, else the character's first sense. A candidate that
 * already carries `en_word_source` is settled and left alone. A no-op for every other language. Never throws.
 */
export async function settleEnWords(result: EngineResult, story: string, opts: EnWordOptions = {}): Promise<{ result: EngineResult; retried: number; fallbacks: number }> {
  if ((result.language as Language) !== 'en' || !Array.isArray(result.candidates)) return { result, retried: 0, fallbacks: 0 }
  const map = loadSenses()
  const keep = new Map<string, { word: string; source: 'generated' | 'fallback' }>()
  const ask: Item[] = []
  for (const c of result.candidates) {
    if (!isBridgeSlot(c) || c.eliminated || c.en_word_source) continue
    const senses = sensesOf(c, map)
    const word = tidyWord(c.en_word)
    const why = enWordProblem(c.en_word, senses)
    if (!why && word) keep.set(c.kanji, { word, source: 'generated' })
    else ask.push({ kanji: c.kanji, line: String(c.en_line ?? c.one_line_gaze ?? ''), senses, word: word ?? '', why: why ?? 'missing' })
  }
  const fixed = await retryEnWords(ask, story, opts)
  let fallbacks = 0
  for (const b of ask) {
    const next = fixed.get(b.kanji)
    if (next) keep.set(b.kanji, { word: next, source: 'generated' })
    else {
      const fb = fallbackWord(b.senses)
      if (fb) {
        keep.set(b.kanji, { word: fb, source: 'fallback' })
        fallbacks++
      }
    }
  }
  if (keep.size === 0) return { result, retried: ask.length, fallbacks }
  const candidates = result.candidates.map((c) => {
    const k = keep.get(c.kanji)
    return k && isBridgeSlot(c) && !c.eliminated && !c.en_word_source ? { ...c, en_word: k.word, en_word_source: k.source } : c
  })
  return { result: { ...result, candidates }, retried: ask.length, fallbacks }
}
