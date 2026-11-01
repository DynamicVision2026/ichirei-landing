// The ICHIREI engine — pure plumbing.
//
// Cardinal rule (build spec §2): this file contains ZERO selection logic. All of
// the reasoning lives in the prompt files (engine/prompt.ja.md; engine/prompt.zh.md for
// both zh-Hans and zh-Hant; engine/prompt.en.md),
// loaded at request time. This module only:
//   1. loads the prompt file for the requested language,
//   2. injects the context (language, relationship, direction, occasion, occasion_detail) and the
//      story at their marked slots — the MEANING of each code lives in the prompt,
//   3. calls the model,
//   4. parses the model's JSON, stamps the request's context onto it,
//   5. hands it to the palette referee (engine/palette.ts) and returns the refereed result.
// Editing a prompt file changes the engine's behavior with no change to this code.

import Anthropic from '@anthropic-ai/sdk'
import { callSignal, callTimeoutMs, ModelTimeoutError, reviewTimeoutMs, runBudgetMs, shadowGraceMs, timedOut } from './limits.ts'
import { finalizeResult } from './slots.ts'
import { logMainCharacter, logSafetyRemovals } from './main-count.ts'
import { attachStrokes } from './strokes.ts'
import { isJoyo } from './joyo.ts'
import { buildLexiconPrompt, eligibleFor, inEligible, inLexicon, lexiconEchoOf, lexiconModeFromEnv, loadLexicon, type EligibleSet, type Lexicon, type LexiconPromptParts } from './lexicon.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPalette, applyReviewVerdicts, loadPalette } from './palette.ts'
import { runReview } from './review.ts'
import { completeMains, type RefillReport } from './replace.ts'
import { applyGazes, failingGazes, fixGazes } from './gaze.ts'
import {
  DECLINE_MESSAGE,
  DEFAULT_CONTEXT,
  displayScriptOf,
  promptFamilyOf,
  parseContext,
  type Candidate,
  type EngineContext,
  type EngineResult,
  type PromptFamily,
  type Language,
} from './contract.ts'

// --- Configurable in ONE place (build spec §3) ---
const MODEL = process.env.ICHIREI_MODEL ?? 'claude-sonnet-5'
const EFFORT = (process.env.ICHIREI_EFFORT ?? 'medium') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
// The answer itself is short (≈ 1–2k tokens in the slim contract); the limit is mostly room for the REASONING, which counts against it
// too. 8000 was too tight for a long remembrance story (a live run hit it after 105 s), so 14000, and a hit is retried once with 20000.
const MAX_TOKENS = Number(process.env.ICHIREI_MAX_TOKENS ?? 14000)
// One automatic retry when the answer was cut off by the limit above (the reasoning ran long, e.g. on a remembrance story).
const MAX_TOKENS_RETRY = Number(process.env.ICHIREI_MAX_TOKENS_RETRY ?? 20000)
// The review only checks a short answer: the fastest current model at low effort (ICHIREI_REVIEW_MODEL / ICHIREI_REVIEW_EFFORT override).
export const DEFAULT_REVIEW_MODEL = 'claude-haiku-5-5'
const REVIEW_MODEL = process.env.ICHIREI_REVIEW_MODEL ?? DEFAULT_REVIEW_MODEL

// Slots every prompt file must contain. The story slot is the original Phase 0
// placeholder; the four context slots are new in v5.
export const STORY_SLOT = '{{ Paste the story here }}'
/** Optional (a template without it simply has no question): the story-opener question the sender was shown, as one line before the story. */
export const QUESTION_SLOT = '{{ SENDER QUESTION }}'
/** 「別の候補を見る」: the characters already shown for this story (the prompt files say what to do with them). */
export const SHOWN_SLOT = '{{ ALREADY SHOWN }}'
export const CONTEXT_SLOTS = {
  language: '{{ LANGUAGE }}',
  relationship: '{{ RELATIONSHIP }}',
  direction: '{{ DIRECTION }}',
  occasion: '{{ OCCASION }}',
  occasion_detail: '{{ OCCASION_DETAIL }}',
} as const

/** Extra slots the Chinese prompt must contain (its script rules read them). */
export const SCRIPT_SLOTS = {
  display_script: '{{ DISPLAY_SCRIPT }}',
  inscription_script: '{{ INSCRIPTION_SCRIPT }}',
} as const

/** What the prompt sees when a context value was not supplied. */
const UNSPECIFIED = 'unspecified'

const cachedPrompts = new Map<PromptFamily, string>()

/** One prompt file per FAMILY: zh-Hans and zh-Hant both use prompt.zh.md. */
export function promptFileName(language: Language): string {
  return `prompt.${promptFamilyOf(language)}.md`
}

function resolvePromptPath(language: Language): string {
  // ICHIREI_PROMPT_PATH overrides the location; "{lang}" in it is replaced by ja/zh/en,
  // e.g. /prompts/experiment/prompt.{lang}.md. Without "{lang}" the same file is used
  // for every language (an explicit A/B override — mind the language).
  const override = process.env.ICHIREI_PROMPT_PATH
  if (override) return override.split('{lang}').join(promptFamilyOf(language))

  // Try, in order: next to this file (bundled), and cwd-relative (vercel dev / local).
  const file = promptFileName(language)
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [join(here, file), join(process.cwd(), 'engine', file), join(process.cwd(), file)]
  for (const p of candidates) {
    try {
      readFileSync(p)
      return p
    } catch {
      // try next
    }
  }
  // Fall back to the first candidate so the thrown error names a concrete path.
  return candidates[0]
}

/** Load the prompt template for a language (fresh read unless ICHIREI_CACHE_PROMPT=1). */
export function loadPrompt(language: Language): string {
  // Read fresh unless explicitly caching, so prompt edits take effect without
  // touching code. Set ICHIREI_CACHE_PROMPT=1 to read once per process per language.
  const family = promptFamilyOf(language)
  const cached = cachedPrompts.get(family)
  if (process.env.ICHIREI_CACHE_PROMPT === '1' && cached) return cached
  const path = resolvePromptPath(language)
  const text = readFileSync(path, 'utf8')
  // A prompt that silently dropped a slot would silently drop an input — fail loudly.
  const required = [STORY_SLOT, SHOWN_SLOT, ...Object.values(CONTEXT_SLOTS), ...(family === 'zh' ? Object.values(SCRIPT_SLOTS) : [])]
  const missing = required.filter((slot) => !text.includes(slot))
  if (missing.length > 0) {
    throw new Error(`${promptFileName(language)} is missing slot(s) ${missing.join(', ')} (looked at ${path})`)
  }
  cachedPrompts.set(family, text)
  return text
}

/**
 * Fill a prompt template in ONE pass over the template's own slots, so text inside
 * the story or the free-text occasion_detail that happens to look like a slot is
 * never re-scanned or substituted.
 */
export function fillPrompt(template: string, story: string, context: EngineContext, promptQuestion: string | null = null, shown: readonly string[] = []): string {
  const values = new Map<string, string>([[STORY_SLOT, story], [SHOWN_SLOT, shown.length ? `ALREADY SHOWN FOR THIS STORY: ${shown.join(' ')}\n\n` : ''], [QUESTION_SLOT, promptQuestion ? `QUESTION SHOWN TO THE SENDER (context only): ${promptQuestion.replace(/\s+/g, ' ').trim()}\n\n` : '']])
  for (const key of Object.keys(CONTEXT_SLOTS) as (keyof typeof CONTEXT_SLOTS)[]) {
    values.set(CONTEXT_SLOTS[key], context[key] ?? UNSPECIFIED)
  }
  // Script slots (Chinese prompt only; harmless if a template lacks them). The prompt defines what each value means.
  values.set(SCRIPT_SLOTS.display_script, displayScriptOf(context.language) ?? UNSPECIFIED)
  values.set(SCRIPT_SLOTS.inscription_script, context.inscription_script ?? UNSPECIFIED)
  const pattern = new RegExp([...values.keys()].map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  return template.replace(pattern, (slot) => values.get(slot) as string)
}

/** Pull a single JSON object out of the model's reply, tolerating stray fences/prose. */
export function extractJson(raw: string): EngineResult {
  let text = raw.trim()
  // Strip a leading ```json / ``` fence and its closing fence, if the model added one.
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  }
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first === -1 || last === -1 || last < first) {
    throw new Error('Model reply contained no JSON object')
  }
  const slice = text.slice(first, last + 1)
  return JSON.parse(slice) as EngineResult
}

/**
 * The slim output contract (prompt.*.md, "OUTPUT CONTRACT") no longer asks the model for the context echo, the particulars, the
 * fingerprint's notes, or the always-false `eliminated` fields: they cost output tokens, which cost time. This fills them with
 * neutral values so every later stage (referee, review, contract, order records) sees the same shape as before. It never
 * invents or alters a candidate's kanji, reading, gaze, anchor or truth type. Old-shape answers pass through unchanged.
 */
export function normalizeModelOutput(raw: EngineResult): EngineResult {
  const r = raw as EngineResult & { emotional_register?: unknown }
  const fp = (r.fingerprint ?? {}) as Partial<EngineResult['fingerprint']>
  const register = Array.isArray(fp.emotional_register) ? fp.emotional_register : Array.isArray(r.emotional_register) ? (r.emotional_register as string[]) : null
  const sufficient = r.status === 'sufficient'
  const out: EngineResult = {
    ...r,
    particulars: Array.isArray(r.particulars) ? r.particulars : [],
    fingerprint: {
      relationship_note: fp.relationship_note ?? null,
      scarce_asset: fp.scarce_asset ?? null,
      unsaid_truth: fp.unsaid_truth ?? null,
      dominant_truth_type: fp.dominant_truth_type ?? null,
      dignity_direction: fp.dignity_direction ?? null,
      emotional_register: sufficient ? register : null,
    },
    follow_up_question: r.follow_up_question ?? null,
    candidates: (Array.isArray(r.candidates) ? r.candidates : []).map((c) => ({
      ...c,
      inscription_form: c.inscription_form ?? null,
      unique_truth: c.unique_truth ?? '',
      eliminated: c.eliminated === true,
      eliminated_reason: c.eliminated === true ? (c.eliminated_reason ?? 'eliminated by the model') : null,
      suitability_flag: c.suitability_flag ?? null,
      palette_status: c.palette_status ?? 'ok',
      flags: Array.isArray(c.flags) ? c.flags : [],
    })),
    primary_kanji: r.primary_kanji ?? null,
    runner_up_kanji: r.runner_up_kanji ?? null,
    freestyle_kanji: r.freestyle_kanji ?? null,
    fallback_follow_up_question: r.fallback_follow_up_question ?? null,
  }
  delete (out as { emotional_register?: unknown }).emotional_register
  return out
}

export interface RunEngineOptions {
  apiKey?: string
  signal?: AbortSignal
  /** Called with each raw text delta as the model streams — lets the API layer
   *  keep its own response stream alive and report progress. */
  onDelta?: (text: string) => void
  /** language / relationship / direction / occasion / occasion_detail / inscription_script. Omitted fields: language 'ja',
   *  the rest unspecified. Validated against the code lists in contract.ts. */
  context?: Partial<EngineContext>
  /** The story-opener question the sender was shown (the server's own wording for a known id; engine/story-questions.ts). Context only, one line before the story. */
  promptQuestion?: string | null
  /** 「別の候補を見る」: characters already shown to the sender for THIS story (any form). They are left out of the list, named in the prompt, and removed by the referee from every slot. */
  exclude?: string[]
  /** Token usage of each model call (stage 'select' = the main call, 'review' = the separate review call) — for cost accounting by the test runner. */
  onUsage?: (stage: 'select' | 'review' | 'replace', usage: { model: string; input_tokens: number; output_tokens: number }) => void
  /**
   * Honest progress for the page: 'reading' while the model reads and thinks (nothing to show yet), 'choosing' once it starts
   * writing the characters, 'checking' while the separate review runs, 'replacing' while a missing main card is replaced.
   */
  onStage?: (stage: 'reading' | 'choosing' | 'checking' | 'replacing') => void
  /** How many follow-up answers the sender has already given (the API layer passes it). Lexicon mode: after one, a second "no lexicon character fits" falls back to the palette engine. */
  followUpsUsed?: number
  /** ICHIREI_LEXICON_MODE for this run (tests); default: the environment. */
  lexiconMode?: 'off' | 'shadow' | 'on'
  /** Injected in tests; defaults to the real lexicon file. */
  lexicon?: Lexicon
}

/** The lexicon as one gift sees it: who is eligible, and the prompt blocks built from it. */
interface LexView {
  set: EligibleSet
  parts: LexiconPromptParts
  lexicon: Lexicon
}

/** What one pass through the pipeline produced. `miss` is set when, in lexicon mode, no lexicon character could be used. */
interface PipelineOut {
  result: EngineResult
  miss: null | { reason: 'model_no_fit' | 'no_valid_choice'; register: string[] | null }
}

/**
 * Run one story through the engine and return the parsed JSON contract.
 * `condition` (A/B/C) is accepted for the API contract but intentionally does NOT
 * affect generation — conditions only change presentation (build spec §5), so the
 * same story yields the same candidates regardless of condition.
 *
 * ICHIREI_LEXICON_MODE (engine/lexicon.ts): off = the palette engine as before; shadow (default) = the palette engine answers, and a
 * second, selection-only call asks what the lexicon would have chosen, which is only logged; on = main and second characters come from
 * engine/lexicon.csv, the palette engine is the fallback after a second "nothing fits".
 */
/** One line per request: the story's length, how many live cards of each kind leave the engine, and the reason every removed candidate was removed (codes only). */
/** Where the time of one request went (milliseconds), step by step — measured, not changed: the selection call (with its retries), the referee (code), the review call, the one refill call (with its own review), the gaze-line check (a rewrite call only when a line fails), and the total. */
interface StepTimes {
  total: number
  select: number
  select_attempts: number
  referee: number
  review: number
  refill: number
  gaze: number
  gaze_failing: number
}

function logCards(story: string, context: EngineContext, before: EngineResult, after: EngineResult, refill: RefillReport | null, ms: StepTimes): void {
  try {
    const live = (r: EngineResult, slot: string) => r.candidates.filter((c) => !c.eliminated && c.slot === slot).length
    const removed = after.candidates.filter((c) => c.eliminated).map((c) => ({ slot: c.slot, reason: (c.eliminated_reason ?? 'unknown').slice(0, 80) }))
    console.log(`[ichirei-cards] ${JSON.stringify({ story_chars: [...story].length, language: context.language, occasion: context.occasion, status: after.status, live: { main: live(after, 'main'), second: live(after, 'second'), freestyle: live(after, 'freestyle') }, before_final: before.candidates.filter((c) => !c.eliminated).length, freestyle: context.occasion === 'memorial' ? 'not_offered' : undefined, ms, calls: { select: ms.select_attempts, review: ms.review > 0 ? 1 : 0, refill: refill ? 1 : 0, gaze: ms.gaze_failing > 0 ? 1 : 0 }, removed, refill: refill ? { asked: refill.asked, filled: refill.filled.map((f) => f.slot), rejected: refill.rejected, rescued: refill.rescued.map((f) => f.slot), ms: refill.ms } : null })}`)
  } catch {
    // (a log line must never break a request)
  }
}

export async function runEngine(story: string, condition: 'A' | 'B' | 'C', opts: RunEngineOptions = {}): Promise<EngineResult> {
  const result = attachStrokes(await runEngineInner(story, condition, opts)) // the carving check's stroke counts (engine/strokes.ts)
  logMainCharacter(result) // the day's repeats, visible in the logs (engine/main-count.ts)
  logSafetyRemovals(result) // every card removed for safety, with the reason (no story text)
  return result
}

async function runEngineInner(
  story: string,
  _condition: 'A' | 'B' | 'C',
  opts: RunEngineOptions = {},
): Promise<EngineResult> {
  const trimmed = story.trim()
  if (!trimmed) throw new Error('story is empty')

  const parsed = parseContext(opts.context ?? DEFAULT_CONTEXT)
  if (!parsed.ok) throw new Error(parsed.error)
  const context = parsed.context

  const prompt = fillPrompt(loadPrompt(context.language), trimmed, context, opts.promptQuestion ?? null, opts.exclude ?? [])
  // Load the palette BEFORE spending a reasoning pass: no palette, no blocklist, no run.
  const palette = loadPalette()
  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
  const tStart = Date.now()
  const base = { story: trimmed, context, palette, client, opts, tStart }

  const mode = opts.lexiconMode ?? lexiconModeFromEnv()
  // The lexicon is a helper, never a single point of failure: if it cannot be loaded, the palette engine answers as before.
  let view: LexView | null = null
  if (mode !== 'off') {
    try {
      const lexicon = opts.lexicon ?? loadLexicon()
      const set = eligibleFor(lexicon, palette, context)
      if (opts.exclude?.length) {
        const out = new Set(opts.exclude)
        set.chars = set.chars.filter((ch) => !out.has(ch.kanji) && !(ch.inscription_form && out.has(ch.inscription_form)))
      }
      view = { set, parts: buildLexiconPrompt(lexicon, set, context.relationship, context.language), lexicon }
    } catch (err) {
      console.log(`[ichirei-lexicon] unavailable ${JSON.stringify({ mode, error: (err instanceof Error ? err.message : String(err)).slice(0, 160) })}`)
    }
  }

  if (mode === 'on' && view) {
    if (view.set.chars.length === 0) {
      logMiss(context, 'no_eligible_characters', null, 'fallback', opts.followUpsUsed ?? 0)
      return flagFallback((await runPipeline({ ...base, prompt, view: null })).result, view)
    }
    const first = await runPipeline({ ...base, prompt, view })
    if (!first.miss) return first.result
    const asked = (opts.followUpsUsed ?? 0) > 0
    logMiss(context, first.miss.reason, first.miss.register, asked ? 'fallback' : 'question', opts.followUpsUsed ?? 0)
    // First time: the sender is asked ONE question (the insufficient result already carries it). After the answer, still no fit: the palette engine.
    if (!asked) return first.result
    return flagFallback((await runPipeline({ ...base, prompt, view: null })).result, view)
  }

  if (mode === 'shadow' && view) {
    const shadow = startShadow({ ...base, prompt, view })
    let main: PipelineOut
    try {
      main = await runPipeline({ ...base, prompt, view: null })
    } catch (err) {
      shadow.cancel()
      throw err
    }
    await shadow.finish(main.result)
    return main.result
  }

  return (await runPipeline({ ...base, prompt, view: null })).result
}

interface PipelineArgs {
  story: string
  context: EngineContext
  palette: ReturnType<typeof loadPalette>
  client: Anthropic
  opts: RunEngineOptions
  tStart: number
  /** The filled language prompt. */
  prompt: string
  /** Lexicon mode only: the characters open to this gift and the prompt blocks. null = the palette engine. */
  view: LexView | null
}

/** The user message: the palette engine sends the filled prompt as before; lexicon mode puts the static lexicon block first (cached), then the filled prompt and this gift's list. */
function selectionContent(prompt: string, view: LexView | null): string | Anthropic.TextBlockParam[] {
  if (!view) return prompt
  return [
    { type: 'text', text: view.parts.staticBlock, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: `${prompt}\n\n${view.parts.dynamicBlock}` },
  ]
}

interface Selected {
  message: Anthropic.Message
  extracted: EngineResult
  attempts: number
  maxTokens: number
}

/**
 * The selection call with its retries. One call may take at most ICHIREI_CALL_TIMEOUT_MS (default 150 s). It gets ONE automatic retry —
 * whichever comes first: the call hit that ceiling (same settings), or the model ran out of output room (max_tokens) before finishing its
 * answer (the retry allows ICHIREI_MAX_TOKENS_RETRY, default 20000) — as long as the run budget still has room for it. Only then does the
 * sender see an error. `quiet` (the shadow call) sends no progress to the page.
 */
async function selectWithRetry(a: PipelineArgs, signal: AbortSignal | undefined, quiet: boolean, onUsage?: RunEngineOptions['onUsage']): Promise<Selected> {
  const { client, opts, tStart, prompt, view } = a
  const content = selectionContent(prompt, view)
  const callSelection = async (limitMs: number, maxTokens: number): Promise<Anthropic.Message> => {
    const callSig = callSignal(signal, limitMs)
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: EFFORT },
        messages: [{ role: 'user', content }],
      },
      { signal: callSig },
    )
    let firstDelta = true
    stream.on('text', (text) => {
      if (quiet) return
      if (firstDelta) {
        firstDelta = false
        opts.onStage?.('choosing')
      }
      opts.onDelta?.(text)
    })
    try {
      return await stream.finalMessage()
    } catch (err) {
      if (timedOut(callSig)) throw new ModelTimeoutError(Math.round(Math.min(limitMs, callTimeoutMs()) / 1000))
      throw err
    }
  }
  let maxTokens = MAX_TOKENS
  let attempts = 0
  /** The time left for a retry, or null when there is none (or it was already used). Logs the decision. */
  const retryLimit = (why: 'selection_timeout' | 'max_tokens_hit', extra: Record<string, unknown>): number | null => {
    const spent = Date.now() - tStart
    const room = runBudgetMs() - spent - REVIEW_RESERVE_MS
    const retry = attempts < 2 && room >= MIN_RETRY_MS
    console.log(`[ichirei-engine] ${why} ${JSON.stringify({ after_ms: spent, attempt: attempts, retry, retry_limit_ms: Math.max(0, Math.min(callTimeoutMs(), room)), ...(view ? { lexicon: true } : {}), ...(quiet ? { shadow: true } : {}), ...extra })}`)
    return retry ? Math.min(callTimeoutMs(), room) : null
  }
  // (a run that already spent time — the palette fallback after a lexicon miss — gets only what the budget still allows)
  let limitMs = Math.max(MIN_RETRY_MS, Math.min(callTimeoutMs(), runBudgetMs() - (Date.now() - tStart) - REVIEW_RESERVE_MS))
  for (;;) {
    attempts++
    let message: Anthropic.Message
    try {
      message = await callSelection(limitMs, maxTokens)
    } catch (err) {
      if (!(err instanceof ModelTimeoutError)) throw err
      const next = retryLimit('selection_timeout', {})
      if (next === null) {
        console.log(`[ichirei-timing] ${JSON.stringify({ select_ms: Date.now() - tStart, status: attempts > 1 ? 'timeout_after_retry' : 'timeout', attempts, model: MODEL, effort: EFFORT, max_tokens: maxTokens })}`)
        throw err
      }
      limitMs = next
      if (!quiet) opts.onStage?.('reading')
      continue
    }
    onUsage?.('select', { model: MODEL, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    if (message.stop_reason === 'refusal') {
      throw new Error('Model refused the request')
    }
    const textOut = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    try {
      return { message, extracted: extractJson(textOut), attempts, maxTokens }
    } catch (err) {
      if (message.stop_reason !== 'max_tokens') throw err
      // Reasoning + answer did not fit in max_tokens: try once more with more room instead of showing an error.
      const next = retryLimit('max_tokens_hit', { max_tokens: maxTokens, output_tokens: message.usage?.output_tokens ?? null, effort: EFFORT, retry_max_tokens: MAX_TOKENS_RETRY })
      if (next === null || MAX_TOKENS_RETRY <= maxTokens) {
        throw new Error(`The model ran out of output room (max_tokens ${maxTokens}) before finishing its answer`)
      }
      maxTokens = MAX_TOKENS_RETRY
      limitMs = next
      if (!quiet) opts.onStage?.('reading')
    }
  }
}

/** The model's answer, normalised and stamped with the request's own context (so the echo can never disagree with what was sent). */
function stampResult(extracted: EngineResult, context: EngineContext): EngineResult {
  // The slim output contract leaves out what only the code needs (the context echo, the internal notes, the empty
  // referee fields): fill them with their neutral values here. Plumbing — nothing about the candidates is touched.
  const normalized = normalizeModelOutput(extracted)
  const stamped: EngineResult = {
    ...normalized,
    language: context.language,
    relationship: context.relationship,
    direction: context.direction,
    occasion: context.occasion,
    occasion_detail: context.occasion_detail,
    inscription_script: context.inscription_script,
    ...(context.reader ? { reader: context.reader } : {}),
  }
  // Remembrance: a suggestion only, and only when the sender did not already choose memorial. Normalised here (the model
  // decides; this is plumbing): true or absent, never a stray value.
  if (context.occasion !== 'memorial' && (extracted as { suggest_memorial?: unknown }).suggest_memorial === true) stamped.suggest_memorial = true
  else delete stamped.suggest_memorial
  // Fields the engine reads from the model's answer for its own logs and flow — never passed on to the page.
  for (const k of ['lexicon_miss', 'goodwill_declined', 'truth', 'ideal_character']) delete (stamped as unknown as Record<string, unknown>)[k]
  // Remembrance has no free pick (2026-11-01): the result is the main and the second card. A freestyle the model wrote anyway is dropped here, before the referee, the review or any refill sees it.
  if (context.occasion === 'memorial') {
    stamped.candidates = (stamped.candidates ?? []).filter((c) => c.slot !== 'freestyle')
    stamped.freestyle_kanji = null
  }
  return stamped
}

/** The emotional register the model wrote (top level or in the fingerprint), for the miss log. */
function registerOf(extracted: EngineResult): string[] | null {
  const top = (extracted as { emotional_register?: unknown }).emotional_register
  const fp = (extracted.fingerprint as { emotional_register?: unknown } | undefined)?.emotional_register
  const pick = Array.isArray(top) ? top : Array.isArray(fp) ? fp : null
  return pick ? pick.filter((x): x is string => typeof x === 'string').slice(0, 3) : null
}

/** The goodwill check declined (selection or review): no cards, a polite message, nothing to answer. */
function declinedResult(r: EngineResult, context: EngineContext): EngineResult {
  return {
    ...r,
    status: 'insufficient',
    declined: true,
    follow_up_question: DECLINE_MESSAGE[context.language],
    particulars: [],
    candidates: [],
    primary_kanji: null,
    runner_up_kanji: null,
    freestyle_kanji: null,
    fallback_follow_up_question: null,
    suggest_memorial: undefined,
  }
}

/**
 * Spec v9.1 step 2: the model names the IDEAL character with no limits (before it chooses from the list). When that character is not on
 * this gift's list, one log line says so — the character and codes only, never story text — so the lexicon can grow.
 */
function logIdeal(extracted: EngineResult, a: PipelineArgs, chosen: string | null, tag = '[ichirei-lexicon]') {
  const raw = (extracted as { ideal_character?: unknown }).ideal_character
  const ideal = typeof raw === 'string' ? [...raw.trim()][0] : undefined
  if (!ideal || !a.view) return null
  const onList = inEligible(a.view.set, { kanji: ideal, inscription_form: null }) !== undefined
  if (onList) return { ideal, on_list: true }
  let known = false
  try {
    known = inLexicon(a.view.lexicon, a.palette, ideal)
  } catch {
    // the log is best-effort
  }
  console.log(`${tag} ideal_not_in_lexicon ${JSON.stringify({ ideal, in_lexicon: known, reason: known ? 'in_lexicon_but_not_open_to_this_gift' : 'not_in_lexicon', relationship: a.context.relationship, occasion: a.context.occasion, direction: a.context.direction, language: a.context.language, chosen_main: chosen })}`)
  return { ideal, on_list: false }
}

async function runPipeline(a: PipelineArgs): Promise<PipelineOut> {
  const { story, context, palette, opts, tStart, prompt, view } = a
  opts.onStage?.('reading')
  const { message, extracted, attempts, maxTokens } = await selectWithRetry(a, opts.signal, false, opts.onUsage)
  const selectMs = Date.now() - tStart // (from the start of the request: the selection call, with its retries)
  const stamped = stampResult(extracted, context)
  const modelSaidMiss = view !== null && stamped.status === 'insufficient' && (extracted as { lexicon_miss?: unknown }).lexicon_miss === true
  const onList = view ? (c: Candidate) => inEligible(view.set, c) !== undefined : undefined
  // Readability (spec v9.1 step 4): for a Japanese buyer the MAIN must be a 常用漢字 the receiver can read; the others may be any character.
  const canBeMain = context.language === 'ja' ? (c: Candidate) => isJoyo(c.kanji) : undefined
  const timing = (t: { review_ms: number; replace_ms: number; status: string }) =>
    logTiming({ attempts, max_tokens_used: maxTokens, select_ms: selectMs, ...t, total_ms: Date.now() - tStart, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null, lexicon: view !== null })
  /** Close a lexicon-mode result: the report, and the classical line from the lexicon (never from the palette). */
  const finishLexicon = (r: EngineResult): EngineResult => {
    if (!view || r.declined) return r
    const withLine: EngineResult = { ...r, candidates: r.candidates.map((c) => ({ ...c, classical_echo: c.slot !== 'freestyle' && !c.eliminated ? lexiconEchoOf(view.set, c) : null })) }
    return { ...withLine, lexicon: { mode: 'on', outcome: r.status === 'sufficient' ? 'chosen' : 'question', eligible: view.set.chars.length } }
  }

  // Goodwill check (spec v9.1 step 1): a hostile or mocking story gets a polite decline, not a character.
  if ((extracted as { goodwill_declined?: unknown }).goodwill_declined === true) {
    console.log(`[ichirei-safety] goodwill_decline ${JSON.stringify({ stage: 'selection', language: context.language, relationship: context.relationship, occasion: context.occasion, direction: context.direction })}`)
    timing({ review_ms: 0, replace_ms: 0, status: 'declined' })
    return { result: finishLexicon(declinedResult(stamped, context)), miss: null }
  }
  logIdeal(extracted, a, stamped.primary_kanji ?? null)

  if (modelSaidMiss) {
    const closed = finalizeResult(stamped)
    timing({ review_ms: 0, replace_ms: 0, status: closed.status })
    return { result: finishLexicon(closed), miss: { reason: 'model_no_fit', register: registerOf(extracted) } }
  }

  // Palette referee (engine/palette.ts, data in engine/palette.csv): removes hard_block candidates and refuses an anchorless
  // context_required kanji as primary; promotes slot 2. When no main candidate survives, the result is held (deferInsufficient) so one
  // replacement can be tried before the sender is told there is nothing. A missing or malformed palette fails the request loudly
  // (above), never silently skips the blocklist. In lexicon mode the same pass also rejects any main or second character outside the list.
  const excluded = opts.exclude?.length ? new Set(opts.exclude) : undefined
  const refereed = applyPalette(stamped, palette, story, { deferInsufficient: true, inLexicon: onList, canBeMain, excluded })
  if (refereed.status !== 'sufficient') {
    const closed = finalizeResult(refereed)
    timing({ review_ms: 0, replace_ms: 0, status: closed.status })
    return { result: finishLexicon(closed), miss: null }
  }

  // The separate review call (engine/review.ts): a fresh model call checks the survivors for SAFETY only. Its vetoes are applied by the
  // same referee code (a vetoed main → slot 2 is promoted; a failed or unreviewed freestyle → dropped). It never throws, and a review that
  // cannot be used (timeout, error) costs the customer nothing but the freestyle: the mains stand on the referee alone.
  // The review checks ALL cards (spec v9.1 step 7) — lexicon characters included: the lexicon vouches for a character's classical sense, not for this gift.
  opts.onStage?.('checking')
  const tReview = Date.now()
  const refereeMs = tReview - tStart - selectMs // the code referee (and the stamping before it): no model call
  // (No live main candidate left → nothing to review: a freestyle cannot be shown alone, so it is dropped and the replacement is tried at once.)
  const hasMain = refereed.candidates.some((c) => !c.eliminated && c.slot !== 'freestyle')
  const review = hasMain
    ? await runReview(refereed, palette, story, context, { apiKey: opts.apiKey, signal: opts.signal, model: REVIEW_MODEL, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
    : { ran: false, skipped_reason: 'no main candidate left to review', verdicts: [] }
  const reviewMs = Date.now() - tReview
  // Goodwill (spec v9.1 step 7): the review may also find the story hostile or mocking — then nothing is shown and the sender is politely declined.
  if (review.verdicts.some((v) => !v.pass && v.rule === 'goodwill')) {
    console.log(`[ichirei-safety] goodwill_decline ${JSON.stringify({ stage: 'review', language: context.language, relationship: context.relationship, occasion: context.occasion, direction: context.direction })}`)
    timing({ review_ms: reviewMs, replace_ms: 0, status: 'declined' })
    return { result: finishLexicon(declinedResult({ ...refereed, review: { ran: review.ran, skipped_reason: review.skipped_reason, verdicts: review.verdicts } }, context)), miss: null }
  }
  const reviewed = applyReviewVerdicts(refereed, palette, story, review, { deferInsufficient: true, canBeMain })

  // A main slot that is EMPTY (never produced, or removed by the referee or the review) is replaced — never an extra card beside a filled one.
  const tReplace = Date.now()
  let refill: RefillReport | null = null
  const completed = await completeMains(reviewed, palette, story, context, view ? `${view.parts.staticBlock}\n\n${prompt}\n\n${view.parts.dynamicBlock}` : prompt, {
    apiKey: opts.apiKey,
    signal: opts.signal,
    // the replacement is a selection (it must pass the person test): the selection model; only its review uses the review model
    model: process.env.ICHIREI_REPLACE_MODEL ?? MODEL,
    reviewModel: REVIEW_MODEL,
    onUsage: opts.onUsage,
    onStage: opts.onStage,
    inLexicon: onList,
    mainOk: canBeMain,
    excluded,
    onRefill: (r) => { refill = r },
  })
  // The last gate: at most one main, one second, one freestyle — and never zero cards without a question.
  // The gaze line must complete 「その人は、」 as one sentence about the person (spec v9.4): a line that does not is rewritten once (one small call,
  // only when a line fails). The better of the two lines is kept; a failed or useless rewrite leaves the original. A line is NEVER a reason to lose a card:
  // this step only replaces text, and any error in it leaves `completed` exactly as it was.
  let withGazes = completed
  const tGaze = Date.now()
  const gazeFailing = failingGazes(completed.candidates, context.language).length
  try {
    const gazeFixes = await fixGazes(completed.candidates, story, context.language, { apiKey: opts.apiKey, signal: opts.signal, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
    const applied = applyGazes(completed, gazeFixes)
    if (applied.candidates.length === completed.candidates.length) withGazes = applied
  } catch {
    withGazes = completed
  }
  const gazeMs = Date.now() - tGaze
  const final = finalizeResult(withGazes)
  // Which cards leave the engine, and why a card is missing (reasons are the referee / review codes, no story text and no character): the log a missing card is traced from.
  const refillMs = tGaze - tReplace
  logCards(story, context, completed, final, refill, { total: Date.now() - tStart, select: selectMs, select_attempts: attempts, referee: refereeMs, review: reviewMs, refill: refillMs, gaze: gazeMs, gaze_failing: gazeFailing })
  timing({ review_ms: reviewMs, replace_ms: refillMs, status: final.status })
  // Lexicon mode: a sufficient answer that ended with no usable lexicon character (the model chose outside the list) is a miss like any other.
  if (view && final.status === 'insufficient') return { result: finishLexicon(final), miss: { reason: 'no_valid_choice', register: registerOf(extracted) } }
  return { result: finishLexicon(final), miss: null }
}

/** The palette engine answered after a lexicon miss: say so (`lexicon_miss`), and show no classical line. */
function flagFallback(r: EngineResult, view: LexView): EngineResult {
  return {
    ...r,
    candidates: r.candidates.map((c) => ({ ...c, classical_echo: null, flags: c.eliminated ? c.flags : [...new Set([...c.flags, 'lexicon_miss'])] })),
    lexicon: { mode: 'on', outcome: 'fallback', eligible: view.set.chars.length },
  }
}

/** One log line per miss so the lexicon can grow: relationship, occasion, direction and the story's emotional register — never story text. */
function logMiss(context: EngineContext, reason: string, register: string[] | null, outcome: 'question' | 'fallback', followUpsUsed: number) {
  console.log(`[ichirei-lexicon] miss ${JSON.stringify({ relationship: context.relationship, occasion: context.occasion, direction: context.direction, language: context.language, emotional_register: register, reason, outcome, follow_ups_used: followUpsUsed })}`)
}

/**
 * Shadow mode: while the palette engine answers, ONE selection-only call (lexicon prompt, no streaming to the page, no review, no
 * replacement) runs beside it. When the palette answer is ready, the lexicon's choice is logged next to it and the shadow call is given a
 * short grace (ICHIREI_SHADOW_GRACE_MS) to finish. It can never change or delay the customer's result beyond that grace, and never throws.
 */
function startShadow(a: PipelineArgs) {
  const view = a.view as LexView
  const ac = new AbortController()
  const onOuter = () => ac.abort()
  a.opts.signal?.addEventListener('abort', onOuter)
  const t0 = Date.now()
  type Chosen = { main: string | null; second: string | null; freestyle: string | null; miss: boolean; note?: string }
  const run = (async (): Promise<Chosen | { error: string }> => {
    try {
      const sel = await selectWithRetry(a, ac.signal, true, a.opts.onUsage)
      const stamped = stampResult(sel.extracted, a.context)
      if (stamped.status === 'insufficient') return { main: null, second: null, freestyle: null, miss: (sel.extracted as { lexicon_miss?: unknown }).lexicon_miss === true, note: 'insufficient' }
      const onList = (c: Candidate) => inEligible(view.set, c) !== undefined
      logIdeal(sel.extracted, a, null)
      const refereed = applyPalette(stamped, a.palette, a.story, { deferInsufficient: true, inLexicon: onList, log: () => {} })
      const live = refereed.candidates.filter((c) => !c.eliminated)
      return {
        main: live.find((c) => c.slot === 'main')?.kanji ?? null,
        second: live.find((c) => c.slot === 'second')?.kanji ?? null,
        freestyle: live.find((c) => c.slot === 'freestyle')?.kanji ?? null,
        miss: false,
        note: live.some((c) => c.slot !== 'freestyle') ? undefined : 'no_valid_choice',
      }
    } catch (err) {
      return { error: (err instanceof Error ? err.message : String(err)).slice(0, 160) }
    }
  })()
  const done = () => a.opts.signal?.removeEventListener('abort', onOuter)
  return {
    cancel() {
      ac.abort()
      done()
    },
    async finish(today: EngineResult) {
      try {
        let timer: NodeJS.Timeout | undefined
        const outcome = await Promise.race([run, new Promise<'timeout'>((resolve) => (timer = setTimeout(() => resolve('timeout'), shadowGraceMs())))])
        if (timer) clearTimeout(timer)
        if (outcome === 'timeout') ac.abort()
        const liveToday = (slot: string) => today.candidates.find((c) => !c.eliminated && c.slot === slot)?.kanji ?? null
        const todayMain = today.status === 'sufficient' ? today.primary_kanji : null
        const base = { relationship: a.context.relationship, occasion: a.context.occasion, direction: a.context.direction, language: a.context.language, eligible: view.set.chars.length, today_main: todayMain, today_second: liveToday('second') ?? today.runner_up_kanji, today_freestyle: today.freestyle_kanji, ms: Date.now() - t0 }
        if (outcome === 'timeout') console.log(`[ichirei-lexicon] shadow ${JSON.stringify({ ...base, result: 'timeout' })}`)
        else if ('error' in outcome) console.log(`[ichirei-lexicon] shadow ${JSON.stringify({ ...base, result: 'error', error: outcome.error })}`)
        else {
          console.log(
            `[ichirei-lexicon] shadow ${JSON.stringify({ ...base, result: outcome.miss ? 'miss' : outcome.note ?? 'chosen', lexicon_main: outcome.main, lexicon_second: outcome.second, lexicon_freestyle: outcome.freestyle, same_main: outcome.main !== null && outcome.main === todayMain })}`,
          )
        }
      } finally {
        done()
      }
    },
  }
}

/** One line per run: where the time went (no story text). Read it in the Cloud Run logs. */
function logTiming(t: { attempts: number; max_tokens_used: number; select_ms: number; review_ms: number; replace_ms: number; total_ms: number; status: string; stop_reason: string | null; output_tokens: number | null; lexicon?: boolean }) {
  console.log(`[ichirei-timing] ${JSON.stringify({ ...t, model: MODEL, effort: EFFORT, max_tokens: MAX_TOKENS, review_model: REVIEW_MODEL })}`)
}

const REVIEW_RESERVE_MS = 20_000 // time kept for the review after a retried selection
const MIN_RETRY_MS = 30_000 // a retry with less than this left would only time out again

export const ENGINE_CONFIG = { MODEL, EFFORT, MAX_TOKENS, MAX_TOKENS_RETRY, REVIEW_MODEL, REVIEW_EFFORT: process.env.ICHIREI_REVIEW_EFFORT ?? 'low', CALL_TIMEOUT_MS: callTimeoutMs(), REVIEW_TIMEOUT_MS: reviewTimeoutMs() }
