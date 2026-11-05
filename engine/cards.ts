// Parallel cards (2026-11-01): the gift's cards are written by separate calls that start at the same moment.
//
//   main   — the selection model, lens "the person's deepest truth, from the story's turning point"
//   second — the selection model, lens "a different side of the person, from another scene or habit than the turning point"
//   free   — the small model,     lens "a playful or surprising angle: a habit, place, object or saying; positive; never a negative trait"
//            (not called for remembrance: two calls)
//
// Every call returns its TOP TWO characters, ranked. Each card then goes through its own referee, review and gaze check as soon as it is
// written, in parallel with the others. A rejected character, or a character another (higher) card already took, falls back to the SAME
// call's runner-up — no new selection call, no rerun. Only when both are gone does the slot stay empty: main and second are refilled by
// the existing refill, the free pick is simply not shown (two cards). Pure plumbing: this file chooses no character; it orders, checks and
// joins what the calls wrote, with the same referee, review and gaze code as the single-call engine.

import { usageOf } from './cache-usage.ts'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Candidate, EngineContext, EngineResult, ReviewVerdict } from './contract.ts'
import { applyPalette, applyReviewVerdicts, type Palette } from './palette.ts'
import { runReview } from './review.ts'
import { FREE_FIELDS, FREE_REVIEW_TIMEOUT_MS_DEFAULT } from './replace.ts'
import { SAME_CHARACTER_REASON, finalizeResult } from './slots.ts'
import { appearanceProblem, failingGazes, fixGazes, inventedFacts, rewriteLines, subjectProblem } from './gaze.ts'
import { LANGUAGE_REASON, ensureLineLanguage } from './script.ts'
import { withDisplayReading } from './reading-display.ts'
import { ModelTimeoutError, callSignal, callTimeoutMs, runBudgetMs, timedOut } from './limits.ts'
import { thinkingTokensOf, watchThinkingTokens } from './usage.ts'
import { cleanReading } from '../src/order/reading.ts'
import { purposeFrame, toneLine } from './purpose.ts'

export type CardSlot = 'main' | 'second' | 'freestyle'

/** ICHIREI_CARDS=single keeps the old single selection call (a rollback switch and the fixture for the older tests); anything else is parallel. */
export const cardsMode = (env: NodeJS.ProcessEnv = process.env): 'parallel' | 'single' => (/^(single|off|0|false|no)$/i.test((env.ICHIREI_CARDS ?? '').trim()) ? 'single' : 'parallel')

// ---- settings (all overridable; what was chosen is reported in DEPLOY.md) ---------------------------------------------------------------------------------------------------------
export const CARD_EFFORT = (): 'low' | 'medium' | 'high' => (process.env.ICHIREI_CARD_EFFORT ?? 'low') as 'low' | 'medium' | 'high'
export const CARD_MAX_TOKENS = (): number => Number(process.env.ICHIREI_CARD_MAX_TOKENS ?? 6000)
export const CARD_MAX_TOKENS_RETRY = (): number => Number(process.env.ICHIREI_CARD_MAX_TOKENS_RETRY ?? 14000)
const num = (v: string | undefined, d: number): number => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d)
export const FREE_CALL_MS_DEFAULT = 15_000
export const FREE_LANE_MS_DEFAULT = 30_000
export const FREE_GRACE_MS_DEFAULT = 5_000
const freeCallMs = () => num(process.env.ICHIREI_FREE_CALL_TIMEOUT_MS, FREE_CALL_MS_DEFAULT)
const freeLaneMs = () => num(process.env.ICHIREI_FREE_LANE_MS, FREE_LANE_MS_DEFAULT)
const freeGraceMs = () => num(process.env.ICHIREI_FREE_GRACE_MS, FREE_GRACE_MS_DEFAULT)
/** The free pick's safety net (a second hedged pair of calls when the first pair left no free card) and the extra wait it is given after the other two cards are settled. */
export const FREE_RETRY_GRACE_MS_DEFAULT = 12_000
const freeRetryGraceMs = () => num(process.env.ICHIREI_FREE_RETRY_GRACE_MS, FREE_RETRY_GRACE_MS_DEFAULT)
const freeRetryOn = (): boolean => !/^(off|0|false|no)$/i.test((process.env.ICHIREI_FREE_RETRY ?? '').trim())
const RESERVE_MS = 30_000 // time kept for the checks after a retried call
const MIN_RETRY_MS = 30_000

const LENS: Record<'main' | 'second', string> = {
  main: "the person's deepest truth, from the story's turning point. Candidate 1 is the character you would choose as the primary (the cinnabar one).",
  second:
    "a different side of the person, from another scene or habit than the turning point. The turning point and the person's deepest truth belong to the MAIN card, which another call writes at this moment; yours come from elsewhere in the story: a habit, a way of being, an everyday scene that shows who they are. A second side is almost always there; choose the two characters that show it best. Prefer a truth_type other than \"Turning Point\".",
}

function readEngineFile(file: string, override?: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  for (const p of override ? [override] : [join(here, file), join(process.cwd(), 'engine', file)]) {
    try {
      return readFileSync(p, 'utf8')
    } catch {
      // next
    }
  }
  throw new Error(`${file} not found`)
}

/** The language prompt plus the one-card block (the block is appended: it names the card, the lens and the ranked output). */
export function cardPrompt(basePrompt: string, slot: 'main' | 'second', lexicon = false): string {
  const block = readEngineFile('card-block.md', process.env.ICHIREI_CARD_BLOCK_PATH)
  let extra = '* The `unique_truth` of each candidate is required' + (slot === 'second' ? ', as for any main-slot card.' : '.')
  if (lexicon) {
    // Lexicon mode (ICHIREI_LEXICON_MODE=on): the lexicon's rules, which follow this block, apply to this card. The pair wording of those rules is split between the calls.
    extra +=
      '\n* LEXICON MODE: the lexicon rules after this block apply to your card. Both of your candidates are characters from the list given there, written as there (rule 1), and they differ from each other. Write `truth` and `ideal_character` first, as rule 0 says. The other main card is written by another call at this moment; where those rules speak of the two main cards, read "your card".' +
      (slot === 'main'
        ? ' If NO listed character truly fits this person, answer as rule 6 says (status "insufficient" with "lexicon_miss": true).'
        : ' Give the one or two listed characters that show this other side of the person best (rule 2 chooses by the person, not by the tag). Never write lexicon_miss or "insufficient": the main card decides about a miss. Only if truly none shows another side, reply exactly {"none": true}.') +
      ' The free pick is written by a third call and is not limited to the list (rule 4).'
  }
  return basePrompt + block.replace(/\{\{ SLOT \}\}/g, slot).replace('{{ LENS }}', LENS[slot]).replace('{{ EXTRA }}', extra)
}

/** The compact free-pick prompt for the parallel call: the context, the story, the characters not to use; ranked top two. */
export function freeCardPrompt(story: string, context: EngineContext, avoid: (string | { kanji: string; reason: string })[], retry = false): string {
  const f = FREE_FIELDS[context.language === 'ja' ? 'ja' : context.language === 'en' ? 'en' : 'zh']
  const v: Record<string, string> = {
    LANGUAGE: context.language,
    RELATIONSHIP: context.relationship ?? 'unspecified',
    DIRECTION: context.direction ?? 'unspecified',
    OCCASION: context.occasion ?? 'unspecified',
    OCCASION_DETAIL: context.occasion_detail ?? 'unspecified',
    STORY: story,
    AVOID: JSON.stringify(avoid.map((k) => (typeof k === 'string' ? { kanji: k, reason: 'already shown for this story' } : k)), null, 2),
    FIELDS: f.fields,
    EXTRA: f.extra,
  }
  const body = `${purposeFrame(context)}\n\n${readEngineFile('card-free-prompt.md', process.env.ICHIREI_CARD_FREE_PROMPT_PATH).replace(/\{\{ ([A-Z_]+) \}\}/g, (m, k: string) => v[k] ?? m)}`
  return retry ? `${body}\n\nSECOND ASK: your first answer could not be used (nothing readable, or every card in it was set aside — see the characters to avoid above). Give two usable candidates now, from a different detail of the story, with a line that says only what the story states and nothing about the person's body or looks.` : body
}

// ---- types -------------------------------------------------------------------------------------------------------------------------------------------------------------------------
export interface CardCallInfo {
  slot: CardSlot
  model: string
  effort: string
  ms: number
  attempts: number
  output_tokens: number | null
  /** the prompt cache (launch freeze): the part of the prompt that was NOT cached, what was read from the cache, what was written to it — a read share near 0 on the second and later calls means the cache is not being hit */
  input_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  thinking_tokens: number | null
  stop_reason: string | null
  /**
   * What came of the answer, in codes: ok | none (the model offered none, or said insufficient) | no_candidates (a JSON object without any) | offered_unusable (candidates without a character) |
   * empty | no_json | bad_json (the text was not a JSON object we could read) | refusal | failed (the call itself failed: network, timeout, limit).
   */
  parse: 'ok' | 'none' | 'no_candidates' | 'offered_unusable' | 'empty' | 'no_json' | 'bad_json' | 'refusal' | 'failed'
  offered: number
  /** the free pick is asked twice at the same moment (a hedge against one slow call): which of the two calls this is, and whether its answer was the one used */
  hedge?: 1 | 2
  /** the free pick's safety net: 2 = the second pair of calls */
  round?: 1 | 2
  won?: boolean
  /** the top-level keys of the answer and its length in characters — never any text */
  keys: string[]
  reply_chars: number
  /** for parse "failed": the kind of error (a name or an HTTP status), never a message */
  error?: string
}
export interface CardReviewInfo {
  slot: CardSlot
  kanji: string
  ms: number
  ran: boolean
  pass: boolean
}
export interface CardsReport {
  calls: CardCallInfo[]
  reviews: CardReviewInfo[]
  /** cards set aside by the `subject` code check (the narrator is the acting subject): which slot, and whether the quoted act or only the line was at fault */
  subject_removed: { slot: CardSlot; where: 'anchor' | 'line' }[]
  subject_rewritten: number
  /** lines that remarked on the person's body or looks (「細い目で…」) and went to the one line rewrite BEFORE the review: which slot, and whether a new line came back */
  looks_rewritten: { slot: CardSlot; rewritten: boolean }[]
  /** a card the review rejected under a LINE rule (insult, dignity, truth, subject) got its line rewritten once with the reviewer's note and was checked again: which slot, which rule, whether a new line came back, whether the card then stood */
  line_rescue: { slot: CardSlot; rule: string; rewritten: boolean; saved: boolean }[]
  /** The page's language and script (2026-11-05): a line fixed by conversion, by one rewrite, or the card dropped (codes only). */
  language: { slot: CardSlot; how: 'converted' | 'rewritten' | 'dropped'; code: string }[]
  /** the free pick's safety net: when the first pair of calls (or the first pair's cards) left no free card, a second hedged pair is asked once */
  free_retry: { asked: boolean; why: 'no_candidates' | 'all_set_aside' | null; won: boolean | null }
  collisions: { slot: CardSlot; resolved: 'runner_up' | 'none'; why?: 'character' | 'anchor' }[]
  runner_up_used: CardSlot[]
  /** from the start of the request */
  first_card_ms: number | null
  all_cards_ms: number
  main_call_ms: number
  gaze_ms: number
  gaze_failing: number
  free_dropped: 'late' | null
  /** where the second card came from: its own call, the main call's runner-up, or the refill (set by the engine); null = no second card */
  second_source: 'second_call' | 'main_runner_up' | 'refill' | null
}

export interface CardsArgs {
  story: string
  context: EngineContext
  palette: Palette
  client: Anthropic
  /** The filled language prompt (the main and second cards add the card block to it). */
  prompt: string
  tStart: number
  models: { select: string; review: string; free: string }
  opts: {
    apiKey?: string
    signal?: AbortSignal
    onUsage?: (stage: 'select' | 'review' | 'replace', usage: { model: string; input_tokens: number; output_tokens: number }) => void
    onStage?: (stage: 'reading' | 'choosing' | 'checking' | 'replacing') => void
    onDelta?: (text: string) => void
    onCard?: (partial: EngineResult) => void
    exclude?: string[]
    round?: number
  }
  deps: {
    extractJson: (raw: string) => EngineResult
    /** normalise + stamp the request's own context on a model answer */
    stamp: (extracted: EngineResult) => EngineResult
  }
  canBeMain?: (c: Candidate) => boolean
  excluded?: ReadonlySet<string>
  /**
   * Lexicon mode: the lexicon blocks go around the main and second prompts (the static table first, cached; the gift's list and the rules last), a main or
   * second character outside the list is refused by the referee, and the free pick is exempt. null/absent = the palette engine.
   */
  lexicon?: { staticBlock: string; dynamicBlock: string; inList: (c: Candidate) => boolean } | null
  /** Applied to every result this module hands out while it works (the cards shown early): lexicon mode puts the lexicon's classical line on a card here. */
  finish?: (r: EngineResult) => EngineResult
}

export interface CardsOut {
  /** The main call said the story is insufficient, or the goodwill check declined (stage says where). `miss`: lexicon mode, "no listed character truly fits". */
  early: null | { kind: 'declined' | 'insufficient'; stage: 'selection' | 'review'; stamped: EngineResult; miss: boolean }
  /** The main call's answer as the model wrote it (before stamping): the truth / ideal_character / lexicon_miss fields the logs and the miss flow read. */
  mainExtracted: EngineResult | null
  /** The main call's answer, stamped (status, emotional register, fallback question…); candidates replaced by `candidates`. */
  base: EngineResult | null
  /** Every candidate that was tried, in slot order; the one that stands is not eliminated, the others carry the reason they were set aside. */
  candidates: Candidate[]
  review: { ran: boolean; skipped_reason: string | null; verdicts: ReviewVerdict[] }
  report: CardsReport
  mainRaw: EngineResult | null
}

// ---- helpers -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
const charsOf = (c: Pick<Candidate, 'kanji' | 'inscription_form'>): string[] => [c.kanji, ...(c.inscription_form ? [c.inscription_form] : [])]
const sameChar = (a: Candidate, b: Candidate): boolean => {
  const bs = new Set(charsOf(b))
  return charsOf(a).some((x) => bs.has(x))
}

interface CallOut {
  cands: Candidate[]
  raw: EngineResult | null
  err?: unknown
  /** the goodwill check failed in this answer */
  declined?: boolean
  /** lexicon mode: the model says no listed character fits */
  miss?: boolean
  extracted?: EngineResult
}

interface LaneOut {
  slot: CardSlot
  chosen: Candidate | null
  tried: Candidate[]
  done_ms: number
  /** the second card only: from its own call, or from the main call's runner-up */
  source?: 'second_call' | 'main_runner_up'
}

/** The text of an answer → its JSON object, tolerantly: code fences, prose around it, comment lines and trailing commas are forgiven; the first balanced object that looks like an answer wins. */
export function readJsonObject(raw: string): { obj: Record<string, unknown> | null; parse: 'ok' | 'empty' | 'no_json' | 'bad_json' } {
  let text = raw.trim()
  if (!text) return { obj: null, parse: 'empty' }
  if (text.startsWith('```')) text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const asObject = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
  const tidy = (t: string) => t.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1) {
    // a bare array of candidates
    const a0 = text.indexOf('[')
    const a1 = text.lastIndexOf(']')
    if (a0 !== -1 && a1 > a0) {
      try {
        const arr = JSON.parse(tidy(text.slice(a0, a1 + 1)))
        if (Array.isArray(arr)) return { obj: { candidates: arr }, parse: 'ok' }
      } catch {
        return { obj: null, parse: 'bad_json' }
      }
    }
    return { obj: null, parse: 'no_json' }
  }
  if (last > first) {
    for (const t of [text.slice(first, last + 1), tidy(text.slice(first, last + 1))]) {
      try {
        const o = asObject(JSON.parse(t))
        if (o) return { obj: o, parse: 'ok' }
      } catch {
        // next
      }
    }
  }
  // several objects, or prose between them: the first balanced {…} that parses and looks like an answer
  for (let start = first; start !== -1; start = text.indexOf('{', start + 1)) {
    let depth = 0
    let inStr = false
    for (let k = start; k < text.length; k++) {
      const ch = text[k]
      if (inStr) {
        if (ch === '\\') k++
        else if (ch === '"') inStr = false
      } else if (ch === '"') inStr = true
      else if (ch === '{') depth++
      else if (ch === '}' && --depth === 0) {
        try {
          const o = asObject(JSON.parse(tidy(text.slice(start, k + 1))))
          if (o && ('candidates' in o || 'candidate' in o || 'kanji' in o || 'none' in o || 'status' in o)) return { obj: o, parse: 'ok' }
        } catch {
          // next start
        }
        break
      }
    }
  }
  return { obj: null, parse: 'bad_json' }
}

export interface ReplyRead {
  cands: Candidate[]
  /** the JSON object as the model wrote it */
  obj: Record<string, unknown> | null
  parse: CardCallInfo['parse']
  keys: string[]
  offered: { kanji: string | null; missing: string[] }[]
  insufficient: boolean
}

const hasText = (v: unknown): boolean => typeof v === 'string' && v.trim() !== ''
const CARD_FIELDS = ['kanji', 'reading', 'one_line_gaze', 'story_anchor'] as const

/**
 * Read one card's answer: the object, the elements that are candidates (in any of the shapes a model writes them: `candidates`, `candidate`, one candidate, a bare array, or an
 * object keyed by the slot) and a verdict in codes. Never throws. Two candidates at most, different characters. A candidate needs its character and its line; a missing reading or
 * anchor is left to the referee (a free pick without a verbatim anchor is dropped there).
 */
export function readCardReply(text: string, slot: CardSlot): ReplyRead {
  const j = readJsonObject(text)
  if (!j.obj) return { cands: [], obj: null, parse: j.parse === 'ok' ? 'no_json' : j.parse, keys: [], offered: [], insufficient: false }
  const obj = j.obj
  const keys = Object.keys(obj).slice(0, 14)
  if (obj.none === true) return { cands: [], obj, parse: 'none', keys, offered: [], insufficient: false }
  const insufficient = obj.status === 'insufficient'
  const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : [])
  let list: unknown[] = asList(obj.candidates)
  if (list.length === 0) list = asList(obj.candidate)
  if (list.length === 0) list = asList(obj[slot])
  if (list.length === 0 && hasText(obj.kanji)) list = [obj]
  const elems = list.filter((o): o is Record<string, unknown> => !!o && typeof o === 'object' && (o as { none?: unknown }).none !== true)
  const offered = elems.map((o) => ({ kanji: hasText(o.kanji) ? String(o.kanji).trim() : null, missing: CARD_FIELDS.filter((k) => !hasText(o[k])) as string[] }))
  const out: Candidate[] = []
  for (const o of elems) {
    if (!hasText(o.kanji) || !hasText(o.one_line_gaze)) continue
    const kanji = String(o.kanji).trim()
    if (out.some((x) => x.kanji === kanji)) continue
    const s = (v: unknown) => (hasText(v) ? String(v).trim() : null)
    out.push({
      ...(o as object),
      slot,
      kanji,
      reading: cleanReading(s(o.reading) ?? ''),
      inscription_form: s(o.inscription_form),
      truth_type: (s(o.truth_type) ?? (slot === 'freestyle' ? 'Play' : 'Essence')) as Candidate['truth_type'],
      one_line_gaze: String(o.one_line_gaze).trim(),
      story_anchor: s(o.story_anchor) ?? '',
      unique_truth: s(o.unique_truth) ?? '',
      eliminated: false,
      eliminated_reason: null,
      suitability_flag: s(o.suitability_flag),
      palette_status: 'ok',
      flags: Array.isArray(o.flags) ? (o.flags as unknown[]).filter((f): f is string => typeof f === 'string') : [],
    } as Candidate)
    if (out.length === 2) break
  }
  const parse: CardCallInfo['parse'] = insufficient ? 'none' : out.length > 0 ? 'ok' : elems.length > 0 ? 'offered_unusable' : 'no_candidates'
  return { cands: insufficient ? [] : out, obj, parse, keys, offered, insufficient }
}

export const SAME_ANCHOR_REASON = 'slots: same story detail as the main card'
/** The review rules that fault the LINE, not the character: a rewrite of the line can answer them. */
const LINE_RULES = ['insult', 'dignity', 'truth', 'subject']
export const lineRuleOf = (reason: string | null | undefined): string | null => {
  const m = /^review:\s*([a-z_]+):/i.exec(reason ?? '')
  return m && LINE_RULES.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null
}

/** A card that stands on something the NARRATOR did (the quoted act's subject is the narrator): set aside before the review; the runner-up, one line rewrite, then the refill. */
export const SUBJECT_REASON = 'subject: the quoted act is the narrator\'s own, not the receiver\'s'
export const INVENTED_FACT_REASON = 'review: truth: states a fact about the sender or a relative that the story does not give'

const plain = (s: string): string => s.replace(/\s+/g, '').replace(/[「」『』“”"'、，,。.！!？?…・]/g, '')

/**
 * Do two story quotes come from the same place? True when one contains the other, or when both sit in the same sentence of the story. The free pick must anchor on a different
 * sentence or detail than the main card (which stands on the turning point). A one-sentence story has no "different sentence": only the overlap test applies.
 */
export function anchorsClash(a: string, b: string, story: string): boolean {
  const x = plain(a)
  const y = plain(b)
  if (!x || !y) return false
  if (x.includes(y) || y.includes(x)) return true
  const sentences = story.split(/(?<=[。！？!?\n])/).map(plain).filter(Boolean)
  if (sentences.length < 2) return false
  const ia = sentences.findIndex((s) => s.includes(x))
  const ib = sentences.findIndex((s) => s.includes(y))
  return ia !== -1 && ia === ib
}

export async function runCards(a: CardsArgs): Promise<CardsOut> {
  const { story, context, palette, client, tStart, models, opts, deps } = a
  const log = (l: string) => console.log(l)
  const memorial = context.occasion === 'memorial'
  const at = () => Date.now() - tStart

  const stop = new AbortController()
  const onOuter = () => stop.abort()
  opts.signal?.addEventListener('abort', onOuter)
  const signal = stop.signal
  const freeStop = new AbortController()
  const freeSignal = AbortSignal.any([signal, freeStop.signal, AbortSignal.timeout(freeLaneMs())])

  const report: CardsReport = { calls: [], reviews: [], subject_removed: [], subject_rewritten: 0, looks_rewritten: [], line_rescue: [], language: [], free_retry: { asked: false, why: null, won: null }, collisions: [], runner_up_used: [], first_card_ms: null, all_cards_ms: 0, main_call_ms: 0, gaze_ms: 0, gaze_failing: 0, free_dropped: null, second_source: null }
  const verdicts: ReviewVerdict[] = []
  let anyReviewRan = false
  let skipped: string | null = null
  let early: CardsOut['early'] = null
  let mainRaw: EngineResult | null = null
  let mainExtracted: EngineResult | null = null
  let freeClosed = false
  let freeRetrying = false // the free pick's second pair of calls is under way (the join waits a little longer for it)

  // progress for the page: only ever forward (reading → choosing → checking)
  const order = ['reading', 'choosing', 'checking'] as const
  let stageAt = -1
  const advance = (s: (typeof order)[number]) => {
    const i = order.indexOf(s)
    if (i > stageAt) {
      stageAt = i
      opts.onStage?.(s)
    }
  }
  advance('reading')

  // ---- the calls: all started now ---------------------------------------------------------------------------------------------------------------------------------------------
  const room = () => runBudgetMs() - at() - RESERVE_MS

  const modelCall = async (slot: CardSlot, content: string | Anthropic.TextBlockParam[], model: string, effort: string, maxTokens: number, ceilingMs: number, retryable: boolean, sig: AbortSignal, extra: { noThinking?: boolean; hedge?: 1 | 2; round?: 1 | 2 } = {}): Promise<CallOut> => {
    const info: CardCallInfo = { slot, model, effort, ms: 0, attempts: 0, output_tokens: null, thinking_tokens: null, stop_reason: null, parse: 'failed', offered: 0, keys: [], reply_chars: 0, ...(extra.hedge ? { hedge: extra.hedge } : {}), ...(extra.round === 2 ? { round: 2 as const } : {}) }
    report.calls.push(info)
    const t0 = Date.now()
    let limit = ceilingMs
    let tokens = maxTokens
    // One line per call, codes only: what the answer was (parse, keys, length), what was offered (character and the fields it lacks), and how the call ended. Never any story text.
    const logCall = (more: Record<string, unknown> = {}, offered: ReplyRead['offered'] = []) =>
      log(`[ichirei-card-call] ${JSON.stringify({ slot, ...(extra.hedge ? { hedge: extra.hedge } : {}), ...(extra.round === 2 ? { round: 2 } : {}), model, effort, ms: info.ms, attempts: info.attempts, stop_reason: info.stop_reason, output_tokens: info.output_tokens, input_tokens: info.input_tokens, cache_read_tokens: info.cache_read_tokens, cache_write_tokens: info.cache_write_tokens, thinking_tokens: info.thinking_tokens, parse: info.parse, keys: info.keys, reply_chars: info.reply_chars, offered, ...more })}`)
    try {
      for (;;) {
        info.attempts++
        const callSig = callSignal(sig, limit)
        let message: Anthropic.Message
        let seen: () => number | null
        try {
          const stream = client.messages.stream({ model, max_tokens: tokens, output_config: { effort: effort as 'low' }, messages: [{ role: 'user', content }], ...(extra.noThinking ? { thinking: { type: 'disabled' as const } } : {}) }, { signal: callSig })
          seen = watchThinkingTokens(stream)
          if (slot === 'main') {
            let first = true
            stream.on('text', (text) => {
              if (first) {
                first = false
                advance('choosing')
              }
              opts.onDelta?.(text)
            })
          }
          message = await stream.finalMessage()
        } catch (err) {
          if (timedOut(callSig) && retryable && info.attempts < 2 && room() >= MIN_RETRY_MS) {
            limit = Math.min(callTimeoutMs(), room())
            continue
          }
          if (timedOut(callSig)) throw new ModelTimeoutError(Math.round(Math.min(limit, callTimeoutMs()) / 1000))
          throw err
        }
        opts.onUsage?.('select', usageOf(model, message.usage))
        info.ms = Date.now() - t0
        info.output_tokens = message.usage?.output_tokens ?? null
        info.input_tokens = message.usage?.input_tokens ?? 0
        info.cache_read_tokens = message.usage?.cache_read_input_tokens ?? 0
        info.cache_write_tokens = message.usage?.cache_creation_input_tokens ?? 0
        info.thinking_tokens = thinkingTokensOf(message, seen())
        info.stop_reason = message.stop_reason ?? null
        const text = message.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('')
        info.reply_chars = [...text].length
        if (message.stop_reason === 'refusal') {
          info.parse = 'refusal'
          logCall()
          // the main card is the request: a refusal there is an error, as in the single call; for the others the slot is simply empty
          return slot === 'main' ? { cands: [], raw: null, err: new Error('Model refused the request') } : { cands: [], raw: null }
        }
        const read = readCardReply(text, slot)
        info.keys = read.keys
        const unreadable = read.parse === 'empty' || read.parse === 'no_json' || read.parse === 'bad_json'
        if (unreadable && message.stop_reason === 'max_tokens' && retryable && info.attempts < 2 && CARD_MAX_TOKENS_RETRY() > tokens && room() >= MIN_RETRY_MS) {
          tokens = CARD_MAX_TOKENS_RETRY()
          limit = Math.min(callTimeoutMs(), room())
          continue
        }
        let cands = read.cands
        // the free pick is shown with its character, its reading and a verbatim anchor, or not at all
        if (slot === 'freestyle') cands = cands.filter((c) => c.reading !== '' && c.story_anchor !== '')
        let parse = read.parse
        if (parse === 'ok' && cands.length === 0) parse = 'offered_unusable'
        info.parse = parse
        info.offered = cands.length
        let out: CallOut = { cands, raw: null }
        if (slot !== 'freestyle') {
          if (unreadable) {
            const why = message.stop_reason === 'max_tokens' ? `The model ran out of output room (max_tokens ${tokens}) before finishing its answer` : 'Model reply contained no JSON object'
            if (slot === 'main') out = { cands: [], raw: null, err: new Error(why) }
          } else {
            const obj = read.obj ?? {}
            const stamped = deps.stamp({ ...obj, status: read.insufficient ? 'insufficient' : 'sufficient', candidates: cands } as unknown as EngineResult)
            const mine = (stamped.candidates ?? []).filter((c) => !c.eliminated && hasText(c.kanji)).map((c) => ({ ...c, slot }) as Candidate)
            out = { cands: read.insufficient ? [] : mine, raw: stamped, declined: obj.goodwill_declined === true, miss: obj.lexicon_miss === true, extracted: obj as unknown as EngineResult }
          }
        }
        logCall({}, read.offered)
        return out
      }
    } catch (err) {
      info.ms = Date.now() - t0
      info.parse = 'failed'
      info.error = (err as Error)?.name === 'ModelTimeoutError' ? 'timeout' : sig.aborted ? 'cancelled' : String((err as { status?: unknown })?.status ?? (err as Error)?.name ?? 'error').slice(0, 40)
      logCall({ error: info.error })
      return { cands: [], raw: null, err }
    }
  }

  // main and second: the language prompt + the one-card block; in lexicon mode the static lexicon table goes first (cached) and the gift's list and rules last (as the single call did)
  const contentOf = (p: string): string | Anthropic.TextBlockParam[] =>
    a.lexicon
      ? [
          { type: 'text', text: a.lexicon.staticBlock, cache_control: { type: 'ephemeral' } },
          { type: 'text', text: `${p}\n\n${a.lexicon.dynamicBlock}` },
        ]
      : p
  const callMain = modelCall('main', contentOf(cardPrompt(a.prompt, 'main', !!a.lexicon)), models.select, CARD_EFFORT(), CARD_MAX_TOKENS(), callTimeoutMs(), true, signal)
  const callSecond = modelCall('second', contentOf(cardPrompt(a.prompt, 'second', !!a.lexicon)), models.select, CARD_EFFORT(), CARD_MAX_TOKENS(), callTimeoutMs(), true, signal)
  // The free pick is asked TWICE at the same moment (the same prompt, the small model, low effort, no extended thinking, 1,500 tokens, the same ceiling): the first answer that is
  // readable and offers a card wins and the other call is cancelled. If both fail or time out, the sender sees two cards, as before.
  const hedgedFree = (round: 1 | 2 = 1, avoid: { kanji: string; reason: string }[] = []): Promise<CallOut> => {
    const content = freeCardPrompt(story, context, [...(opts.exclude ?? []), ...avoid], round === 2)
    const stops = [new AbortController(), new AbortController()]
    return new Promise<CallOut>((resolve) => {
      const results: (CallOut | null)[] = [null, null]
      let decided = false
      const infoOf = (h: 1 | 2) => report.calls.find((c) => c.slot === 'freestyle' && c.hedge === h && (c.round ?? 1) === round)
      const done = (winner: 1 | 2 | null, out: CallOut) => {
        decided = true
        const w = infoOf(1)
        const v = infoOf(2)
        if (w) w.won = winner === 1
        if (v) v.won = winner === 2
        log(`[ichirei-card-call] ${JSON.stringify({ slot: 'freestyle', hedged: 2, ...(round === 2 ? { round } : {}), hedge_winner: winner })}`)
        resolve(out)
      }
      ;([1, 2] as const).forEach((h, i) => {
        void modelCall('freestyle', content, models.free, 'low', 1500, freeCallMs(), false, AbortSignal.any([freeSignal, stops[i].signal]), { noThinking: true, hedge: h, round }).then((out) => {
          results[i] = out
          if (decided) return
          if (out.cands.length > 0) {
            stops[1 - i].abort() // the other call is cancelled
            done(h, out)
          } else if (results[0] && results[1]) done(null, results[0])
        })
      })
    })
  }
  const callFree = memorial ? null : hedgedFree()

  const ctxBase = deps.stamp({ status: 'sufficient', candidates: [] } as unknown as EngineResult)

  // ---- per-card checks ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const picked: Partial<Record<CardSlot, Candidate>> = {} // the candidate each card is currently putting forward (a lower card avoids these without waiting)

  const miniOf = (base: EngineResult, c: Candidate): EngineResult => ({
    ...base,
    status: 'sufficient',
    candidates: [c],
    primary_kanji: c.slot === 'freestyle' ? null : c.kanji,
    runner_up_kanji: null,
    freestyle_kanji: c.slot === 'freestyle' ? c.kanji : null,
    referee: undefined,
    review: undefined,
  })
  const eliminate = (c: Candidate, reason: string, flag: string): Candidate => ({ ...c, eliminated: true, eliminated_reason: reason, flags: [...new Set([...c.flags, flag])] })

  /** The code referee for one card (the same applyPalette the whole result used to go through). */
  const refereeOne = (base: EngineResult, c: Candidate): { ok: boolean; card: Candidate; mini: EngineResult } => {
    const mini = applyPalette(miniOf(base, c), palette, story, { deferInsufficient: true, canBeMain: c.slot === 'main' ? a.canBeMain : undefined, excluded: a.excluded, inLexicon: a.lexicon?.inList, log: () => {} })
    const card = mini.candidates[0] ?? c
    const ok = !card.eliminated && (c.slot !== 'main' || mini.primary_kanji === card.kanji)
    if (!ok && !card.eliminated) return { ok, card: eliminate(card, 'palette: not eligible as the main (readability or anchor)', 'not_eligible_main'), mini }
    return { ok, card, mini }
  }

  const reviewOne = async (base: EngineResult, mini: EngineResult, slot: CardSlot): Promise<{ ok: boolean; card: Candidate }> => {
    advance('checking')
    const t0 = Date.now()
    const rep = await runReview(mini, palette, story, context, {
      apiKey: opts.apiKey,
      signal: slot === 'freestyle' ? callSignal(freeSignal, FREE_REVIEW_TIMEOUT_MS_DEFAULT) : signal,
      model: models.review,
      client,
      onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined,
    })
    verdicts.push(...rep.verdicts)
    if (rep.ran) anyReviewRan = true
    else skipped = skipped ?? rep.skipped_reason
    if (rep.verdicts.some((v) => !v.pass && v.rule === 'goodwill') && !early) {
      early = { kind: 'declined', stage: 'review', stamped: base, miss: false }
      stop.abort()
    }
    const r2 = applyReviewVerdicts(mini, palette, story, rep, { deferInsufficient: true, canBeMain: slot === 'main' ? a.canBeMain : undefined })
    const card = r2.candidates[0] ?? mini.candidates[0]
    const ok = !card.eliminated && (slot !== 'main' || r2.primary_kanji === card.kanji)
    report.reviews.push({ slot, kanji: card.kanji, ms: Date.now() - t0, ran: rep.ran, pass: ok })
    return { ok, card: ok || card.eliminated ? card : eliminate(card, 'review: not eligible as the main', 'review_failed') }
  }

  /** A line that does not read as a sentence about the person is rewritten once (small model, only when it fails): never a reason to lose the card. */
  const gazeOne = async (card: Candidate, sig: AbortSignal): Promise<Candidate> => {
    const failing = failingGazes([card], context.language, story).length
    if (failing === 0) return card
    report.gaze_failing += failing
    const t0 = Date.now()
    try {
      const fixes = await fixGazes([card], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: sig, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
      const line = fixes.get(card.kanji)
      return line ? { ...card, one_line_gaze: line } : card
    } catch {
      return card
    } finally {
      report.gaze_ms += Date.now() - t0
    }
  }

  const lane = async (slot: CardSlot, call: Promise<CallOut>, higher: () => Promise<LaneOut>[], sig: AbortSignal): Promise<LaneOut> => {
    const tried: Candidate[] = []
    let chosen: Candidate | null = null
    let source: LaneOut['source']
    const rescued = new Set<string>() // characters whose line got its one rewrite after a review rejection
    const looksFixed = new Set<string>() // characters whose line got its one rewrite for a remark on the body or looks
    const lineOnly: { card: Candidate; from: NonNullable<LaneOut['source']> }[] = [] // cards whose only fault is a line with the narrator as its subject: the one line rewrite
    try {
      const out = await call
      if (slot === 'main') {
        report.main_call_ms = at()
        if (out.err) return { slot, chosen: null, tried, done_ms: at() } // the caller rethrows
        mainRaw = out.raw
        mainExtracted = out.extracted ?? null
        if (out.raw && out.raw.status !== 'sufficient') {
          early = { kind: out.declined ? 'declined' : 'insufficient', stage: 'selection', stamped: out.raw, miss: out.miss === true }
          stop.abort()
          return { slot, chosen: null, tried, done_ms: at() }
        }
      }
      // (every card is checked against the request's own context — language, occasion, reader — stamped here; the main call's answer only supplies the result's other fields)
      const stampBase = ctxBase
      const taken = (): Candidate[] => (slot === 'main' ? [] : slot === 'second' ? [picked.main] : [picked.main, picked.second]).filter((x): x is Candidate => !!x)
      /** Try a list of candidates in order: referee, a higher card's character, review, the final check against the higher cards, the gaze line. The first that stands is the card. */
      const attempt = async (list: Candidate[], from: NonNullable<LaneOut['source']>): Promise<void> => {
        let n = 0
        for (const cand0 of list) {
          if (early || sig.aborted || chosen) break
          n++
          // The line must be in the page's language and script (2026-11-05): converted in code when only the Chinese script is wrong, otherwise ONE rewrite in the right language, otherwise the
          // card is dropped (the next candidate of this call stands in, then the slot's normal refill).
          const lang = await ensureLineLanguage(cand0.one_line_gaze, context.language, async (why) => {
            if (early || sig.aborted) return null
            const fixes = await rewriteLines([{ kanji: cand0.kanji, gaze: cand0.one_line_gaze, why }], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: sig, client, log, timeoutMs: slot === 'freestyle' ? freeCallMs() : undefined })
            return fixes.get(cand0.kanji) ?? null
          })
          if (lang.how !== 'ok') report.language.push({ slot, how: lang.how, code: lang.code ?? 'unknown' })
          if (lang.how === 'dropped') {
            tried.push(eliminate(cand0, LANGUAGE_REASON, 'language'))
            continue
          }
          const cand = lang.how === 'ok' ? cand0 : ({ ...cand0, one_line_gaze: lang.line } as Candidate)
          const ref = refereeOne(stampBase, cand)
          if (!ref.ok) {
            tried.push(ref.card)
            continue
          }
          // `subject`: the card stands on an act of the narrator (the anchor's acting subject is 俺・私・僕…), or its line has the narrator as its subject. A code check, BEFORE the review.
          // The order is: this call's runner-up (the loop goes on), then one line rewrite (below, lines only), then the refill (the engine, for an empty slot).
          const sub = subjectProblem(ref.card, context.language, story)
          if (sub) {
            tried.push(eliminate(ref.card, SUBJECT_REASON, 'subject'))
            report.subject_removed.push({ slot, where: sub.where })
            if (sub.where === 'line') lineOnly.push({ card: ref.card, from })
            continue
          }
          // a higher card is already putting this character forward: take our runner-up (no review spent on it)
          if (taken().some((t) => sameChar(ref.card, t))) {
            tried.push(eliminate(ref.card, SAME_CHARACTER_REASON, 'same_character'))
            report.collisions.push({ slot, resolved: n < list.length ? 'runner_up' : 'none', why: 'character' })
            continue
          }
          // the free pick must stand on a different sentence or detail than the main card: the same place in the story → its runner-up
          if (slot === 'freestyle' && picked.main && anchorsClash(ref.card.story_anchor, picked.main.story_anchor, story)) {
            tried.push(eliminate(ref.card, SAME_ANCHOR_REASON, 'same_anchor'))
            report.collisions.push({ slot, resolved: n < list.length ? 'runner_up' : 'none', why: 'anchor' })
            continue
          }
          // A line that remarks on the person's body or looks (「いつも細い目でどこかを追っている人」) is never shown and never sent to the review as it is: it goes to the one line rewrite first.
          const looks = appearanceProblem(ref.card.one_line_gaze, context.language)
          if (looks && !looksFixed.has(ref.card.kanji) && !early && !sig.aborted) {
            looksFixed.add(ref.card.kanji)
            const fixes = await rewriteLines([{ kanji: ref.card.kanji, gaze: ref.card.one_line_gaze, why: looks }], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: sig, client, log, timeoutMs: slot === 'freestyle' ? freeCallMs() : undefined })
            const line = fixes.get(ref.card.kanji)
            report.looks_rewritten.push({ slot, rewritten: !!line })
            if (line) {
              await attempt([{ ...ref.card, one_line_gaze: line, eliminated: false, eliminated_reason: null } as Candidate], from)
              if (chosen) break
              continue
            }
            // (no usable rewrite: the card goes on with its line; the shape check after the review asks once more)
          }
          picked[slot] = ref.card
          const rv = await reviewOne(stampBase, ref.mini, slot)
          if (!rv.ok) {
            tried.push(rv.card)
            if (picked[slot] === ref.card) delete picked[slot]
            // A good character is not dropped for its line: when the review rejected the card under a LINE rule (insult, dignity, truth, subject) the line is rewritten ONCE with the reviewer's
            // own note, and the card goes through every check again (the referee, the `subject` guard, the review). Every slot. If the character was the problem, the second review says so.
            const rule = lineRuleOf(rv.card.eliminated_reason)
            if (rule && !rescued.has(ref.card.kanji) && !early && !sig.aborted) {
              rescued.add(ref.card.kanji)
              const note = (rv.card.eliminated_reason ?? '').replace(/^review:\s*[a-z_]+:\s*/i, '').slice(0, 200)
              const fixes = await rewriteLines([{ kanji: ref.card.kanji, gaze: ref.card.one_line_gaze, why: `the reviewer rejected the line under the rule \`${rule}\`${note ? `: ${note}` : ''}. Reword ONLY the line so it says only what the story states and nothing about the person's body, looks or character that could hurt; the character and the story detail stay` }], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: sig, client, log, timeoutMs: slot === 'freestyle' ? freeCallMs() : undefined })
              const line = fixes.get(ref.card.kanji)
              const entry = { slot, rule, rewritten: !!line, saved: false }
              report.line_rescue.push(entry)
              if (line) {
                await attempt([{ ...ref.card, one_line_gaze: line, eliminated: false, eliminated_reason: null } as Candidate], from)
                if (chosen) {
                  entry.saved = true
                  break
                }
              }
            }
            continue
          }
          // the final check against what the higher cards ended up with
          const finals = await Promise.all(higher())
          if (finals.some((f) => f.chosen && sameChar(rv.card, f.chosen))) {
            tried.push(eliminate(rv.card, SAME_CHARACTER_REASON, 'same_character'))
            report.collisions.push({ slot, resolved: n < list.length ? 'runner_up' : 'none', why: 'character' })
            if (picked[slot] === ref.card) delete picked[slot]
            continue
          }
          const mainFinal = finals.find((f) => f.slot === 'main')?.chosen
          if (slot === 'freestyle' && mainFinal && anchorsClash(rv.card.story_anchor, mainFinal.story_anchor, story)) {
            tried.push(eliminate(rv.card, SAME_ANCHOR_REASON, 'same_anchor'))
            report.collisions.push({ slot, resolved: n < list.length ? 'runner_up' : 'none', why: 'anchor' })
            if (picked[slot] === ref.card) delete picked[slot]
            continue
          }
          const lined = await gazeOne(rv.card, sig)
          // the line still states a fact about the sender or a relative that the story does not give (after its one rewrite): it is a `truth` failure, the next candidate is tried
          const invented = inventedFacts(lined.one_line_gaze, story, context.language)
          if (invented.length > 0) {
            tried.push(eliminate(lined, INVENTED_FACT_REASON, 'invented_fact'))
            if (picked[slot] === ref.card) delete picked[slot]
            continue
          }
          chosen = context.language === 'ja' ? withDisplayReading(lined, palette) : lined
          picked[slot] = chosen
          tried.push(chosen)
          source = from
          if (n > 1 && from === 'second_call') report.runner_up_used.push(slot)
          break
        }
      }
      await attempt(out.cands, 'second_call')
      // The free pick's SAFETY NET: when the first pair of calls left no free card (both failed or came back empty, or every card they offered was set aside — by the referee, a collision with a
      // higher card, the review, or the `subject` guard), the pair is asked ONCE more at the same moment, told which characters were set aside and why (codes), within the free lane's own time.
      // The first two cards never wait for it; the join gives it a short extra wait (ICHIREI_FREE_RETRY_GRACE_MS). ICHIREI_FREE_RETRY=off switches it off.
      if (slot === 'freestyle' && !chosen && !early && !sig.aborted && freeRetryOn()) {
        const why: 'no_candidates' | 'all_set_aside' = out.cands.length === 0 ? 'no_candidates' : 'all_set_aside'
        const avoid = tried.filter((t) => t.eliminated).map((t) => ({ kanji: t.kanji, reason: `set aside (${String(t.eliminated_reason ?? 'refused').split(':').slice(0, 2).join(':').trim().slice(0, 40)}): choose another character from a different detail of the story` }))
        report.free_retry = { asked: true, why, won: null }
        freeRetrying = true
        log(`[ichirei-engine] free_retry ${JSON.stringify({ round: opts.round ?? 1, why, avoided: avoid.length + (opts.exclude?.length ?? 0) })}`)
        const out2 = await hedgedFree(2, avoid)
        await attempt(out2.cands, 'second_call')
        report.free_retry.won = !!chosen
      }
      // The second card: when its own call could not deliver (a failed or unreadable answer, nothing offered, or everything it offered was set aside), the MAIN call's runner-up
      // becomes the second card, after its own referee and review — no refill. It is reviewed in parallel with the main card's own review. The refill is for when this fails too.
      if (slot === 'second' && !chosen && !early && !sig.aborted) {
        const mo = await callMain
        const spare = mo.err ? [] : mo.cands.slice(1).map((c) => ({ ...c, slot: 'second' }) as Candidate)
        if (spare.length > 0) {
          log(`[ichirei-engine] second_from_main_runner_up ${JSON.stringify({ second_call: report.calls.find((c) => c.slot === 'second')?.parse ?? null, spare: spare.length })}`)
          await attempt(spare, 'main_runner_up')
          if (chosen) report.runner_up_used.push('second')
        }
      }
      // The one line rewrite, only for a card whose ONLY fault is a line about the narrator, and only when no runner-up stood: the small model rewrites the line, then the card goes
      // through the same checks again. (A card whose quoted act is the narrator's own cannot be saved by a new line: it goes to the refill.)
      if (!chosen && !early && !sig.aborted && lineOnly.length > 0) {
        const first = lineOnly[0]
        const fixes = await rewriteLines([{ kanji: first.card.kanji, gaze: first.card.one_line_gaze, why: 'its subject is the narrator (the sender): rewrite it so the subject is the person who receives the gift, built only from what that person does in the story' }], story, context.language, { tone: toneLine(context), apiKey: opts.apiKey, signal: sig, client, log })
        const line = fixes.get(first.card.kanji)
        if (line) {
          report.subject_rewritten++
          await attempt([{ ...first.card, one_line_gaze: line, eliminated: false, eliminated_reason: null } as Candidate], first.from)
        }
      }
    } catch (err) {
      log(`[ichirei-engine] card_lane_failed ${JSON.stringify({ slot, error: (err instanceof Error ? err.message : String(err)).slice(0, 120) })}`)
    }
    return { slot, chosen, tried, done_ms: at(), source }
  }

  // The lanes. Each starts as soon as its call is done; none waits for a lower card. (`higher` is read lazily so a lane can wait for the cards above it.)
  let laneMain!: Promise<LaneOut>
  let laneSecond!: Promise<LaneOut>
  let laneFree: Promise<LaneOut> | null = null
  laneMain = lane('main', callMain, () => [], signal)
  laneSecond = lane('second', callSecond, () => [laneMain], signal)
  if (callFree) laneFree = lane('freestyle', callFree, () => [laneMain, laneSecond], freeSignal)

  // ---- show each card as soon as it passes: main, then second, then free ---------------------------------------------------------------------------------------------------
  const snapshot = (cards: Candidate[]): EngineResult | null => {
    const b = mainRaw
    if (!b || cards.length === 0) return null
    const free = cards.find((c) => c.slot === 'freestyle')
    const done = finalizeResult({ ...b, status: 'sufficient', candidates: cards, primary_kanji: cards[0].kanji, runner_up_kanji: cards.find((c) => c.slot === 'second')?.kanji ?? null, freestyle_kanji: free?.kanji ?? null, referee: undefined, review: undefined }, () => {})
    return a.finish ? a.finish(done) : done
  }
  const fire = (cards: Candidate[]) => {
    try {
      const s = snapshot(cards)
      if (!s || early) return
      if (report.first_card_ms === null) report.first_card_ms = at()
      opts.onCard?.(s)
    } catch {
      // (showing a card early is a courtesy; the final result carries everything)
    }
  }
  const emitter = (async () => {
    const m = await laneMain
    if (!m.chosen || early) return
    fire([m.chosen])
    const s = await laneSecond
    if (!s.chosen || early) return
    fire([m.chosen, s.chosen])
    if (!laneFree) return
    const f = await laneFree
    if (f.chosen && !freeClosed && !early) fire([m.chosen, s.chosen, f.chosen])
  })()

  // ---- join -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const mainOut = await callMain
  if (mainOut.err) {
    stop.abort()
    opts.signal?.removeEventListener('abort', onOuter)
    throw mainOut.err
  }
  const [lm, ls] = await Promise.all([laneMain, laneSecond])
  // the free pick never delays the others: it gets a short grace after the main and second cards are settled, then it is let go (two cards)
  let lf: LaneOut | null = null
  if (laneFree) {
    const grace = new Promise<null>((r) => setTimeout(() => r(null), freeGraceMs()).unref?.())
    lf = await Promise.race([laneFree, grace])
    if (!lf && freeRetrying) {
      const more = new Promise<null>((r) => setTimeout(() => r(null), freeRetryGraceMs()).unref?.())
      lf = await Promise.race([laneFree, more])
    }
    if (!lf) {
      freeClosed = true
      freeStop.abort()
      report.free_dropped = 'late'
      lf = { slot: 'freestyle', chosen: null, tried: [], done_ms: at() }
    }
  }
  await emitter.catch(() => {})
  opts.signal?.removeEventListener('abort', onOuter)
  report.all_cards_ms = at()

  if (early) {
    const e = early as NonNullable<CardsOut['early']>
    return { early: e, base: e.stamped, candidates: [], review: { ran: anyReviewRan, skipped_reason: skipped, verdicts }, report, mainRaw, mainExtracted }
  }
  report.second_source = ls.chosen ? (ls.source ?? 'second_call') : null
  const candidates = [...lm.tried, ...ls.tried, ...(lf?.tried ?? [])]
  return { early: null, base: mainRaw, candidates, review: { ran: anyReviewRan, skipped_reason: anyReviewRan ? null : skipped, verdicts }, report, mainRaw, mainExtracted }
}
