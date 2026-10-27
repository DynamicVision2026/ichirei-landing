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
import { callSignal, callTimeoutMs, ModelTimeoutError, reviewTimeoutMs, runBudgetMs, timedOut } from './limits.ts'
import { finalizeResult } from './slots.ts'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyPalette, applyReviewVerdicts, loadPalette } from './palette.ts'
import { runReview } from './review.ts'
import { completeMains } from './replace.ts'
import {
  DEFAULT_CONTEXT,
  displayScriptOf,
  promptFamilyOf,
  parseContext,
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
  const required = [STORY_SLOT, ...Object.values(CONTEXT_SLOTS), ...(family === 'zh' ? Object.values(SCRIPT_SLOTS) : [])]
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
export function fillPrompt(template: string, story: string, context: EngineContext): string {
  const values = new Map<string, string>([[STORY_SLOT, story]])
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
  /** Token usage of each model call (stage 'select' = the main call, 'review' = the separate review call) — for cost accounting by the test runner. */
  onUsage?: (stage: 'select' | 'review' | 'replace', usage: { model: string; input_tokens: number; output_tokens: number }) => void
  /**
   * Honest progress for the page: 'reading' while the model reads and thinks (nothing to show yet), 'choosing' once it starts
   * writing the characters, 'checking' while the separate review runs, 'replacing' while a missing main card is replaced.
   */
  onStage?: (stage: 'reading' | 'choosing' | 'checking' | 'replacing') => void
}

/**
 * Run one story through the engine and return the parsed JSON contract.
 * `condition` (A/B/C) is accepted for the API contract but intentionally does NOT
 * affect generation — conditions only change presentation (build spec §5), so the
 * same story yields the same candidates regardless of condition.
 */
export async function runEngine(
  story: string,
  _condition: 'A' | 'B' | 'C',
  opts: RunEngineOptions = {},
): Promise<EngineResult> {
  const trimmed = story.trim()
  if (!trimmed) throw new Error('story is empty')

  const parsed = parseContext(opts.context ?? DEFAULT_CONTEXT)
  if (!parsed.ok) throw new Error(parsed.error)
  const context = parsed.context

  const prompt = fillPrompt(loadPrompt(context.language), trimmed, context)
  // Load the palette BEFORE spending a reasoning pass: no palette, no blocklist, no run.
  const palette = loadPalette()

  const client = new Anthropic(opts.apiKey ? { apiKey: opts.apiKey } : {})
  const tStart = Date.now()
  opts.onStage?.('reading')

  // Stream + finalMessage so reasoning doesn't hit an HTTP timeout; the function still returns one assembled JSON response.
  // One call may take at most ICHIREI_CALL_TIMEOUT_MS (default 150 s). The selection gets ONE automatic retry — whichever comes first:
  // the call hit that ceiling (same settings), or the model ran out of output room (max_tokens) before finishing its answer (the
  // retry allows ICHIREI_MAX_TOKENS_RETRY, default 20000) — as long as the run budget still has room for it. Only then does the
  // sender see an error.
  const callSelection = async (limitMs: number, maxTokens: number): Promise<Anthropic.Message> => {
    const signal = callSignal(opts.signal, limitMs)
    const stream = client.messages.stream(
      {
        model: MODEL,
        max_tokens: maxTokens,
        output_config: { effort: EFFORT },
        messages: [{ role: 'user', content: prompt }],
      },
      { signal },
    )
    let firstDelta = true
    stream.on('text', (text) => {
      if (firstDelta) {
        firstDelta = false
        opts.onStage?.('choosing')
      }
      opts.onDelta?.(text)
    })
    try {
      return await stream.finalMessage()
    } catch (err) {
      if (timedOut(signal)) throw new ModelTimeoutError(Math.round(Math.min(limitMs, callTimeoutMs()) / 1000))
      throw err
    }
  }
  let maxTokens = MAX_TOKENS
  let attempts = 0
  let message!: Anthropic.Message
  let extracted!: EngineResult
  /** The time left for a retry, or null when there is none (or it was already used). Logs the decision. */
  const retryLimit = (why: 'selection_timeout' | 'max_tokens_hit', extra: Record<string, unknown>): number | null => {
    const spent = Date.now() - tStart
    const room = runBudgetMs() - spent - REVIEW_RESERVE_MS
    const retry = attempts < 2 && room >= MIN_RETRY_MS
    console.log(`[ichirei-engine] ${why} ${JSON.stringify({ after_ms: spent, attempt: attempts, retry, retry_limit_ms: Math.max(0, Math.min(callTimeoutMs(), room)), ...extra })}`)
    return retry ? Math.min(callTimeoutMs(), room) : null
  }
  let limitMs = callTimeoutMs()
  for (;;) {
    attempts++
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
      opts.onStage?.('reading')
      continue
    }
    opts.onUsage?.('select', { model: MODEL, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })
    if (message.stop_reason === 'refusal') {
      throw new Error('Model refused the request')
    }
    const textOut = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    try {
      extracted = extractJson(textOut)
      break
    } catch (err) {
      if (message.stop_reason !== 'max_tokens') throw err
      // Reasoning + answer did not fit in max_tokens: try once more with more room instead of showing an error.
      const next = retryLimit('max_tokens_hit', { max_tokens: maxTokens, output_tokens: message.usage?.output_tokens ?? null, effort: EFFORT, retry_max_tokens: MAX_TOKENS_RETRY })
      if (next === null || MAX_TOKENS_RETRY <= maxTokens) {
        throw new Error(`The model ran out of output room (max_tokens ${maxTokens}) before finishing its answer`)
      }
      maxTokens = MAX_TOKENS_RETRY
      limitMs = next
      opts.onStage?.('reading')
    }
  }
  const selectMs = Date.now() - tStart

  // The slim output contract leaves out what only the code needs (the context echo, the internal notes, the empty
  // referee fields): fill them with their neutral values here. Plumbing — nothing about the candidates is touched.
  const normalized = normalizeModelOutput(extracted)
  // The request's own context values are stamped on the result, so the echo can never disagree with what the caller actually sent.
  const stamped: EngineResult = {
    ...normalized,
    language: context.language,
    relationship: context.relationship,
    direction: context.direction,
    occasion: context.occasion,
    occasion_detail: context.occasion_detail,
    inscription_script: context.inscription_script,
  }
  // Remembrance: a suggestion only, and only when the sender did not already choose memorial. Normalised here (the model
  // decides; this is plumbing): true or absent, never a stray value.
  if (context.occasion !== 'memorial' && (extracted as { suggest_memorial?: unknown }).suggest_memorial === true) stamped.suggest_memorial = true
  else delete stamped.suggest_memorial

  // Palette referee (engine/palette.ts, data in engine/palette.csv): removes hard_block candidates and refuses an anchorless
  // context_required kanji as primary; promotes slot 2. When no main candidate survives, the result is held (deferInsufficient) so one
  // replacement can be tried before the sender is told there is nothing. A missing or malformed palette fails the request loudly
  // (above), never silently skips the blocklist.
  const refereed = applyPalette(stamped, palette, trimmed, { deferInsufficient: true })
  if (refereed.status !== 'sufficient') {
    const closed = finalizeResult(refereed)
    logTiming({ attempts, max_tokens_used: maxTokens, select_ms: selectMs, review_ms: 0, replace_ms: 0, total_ms: Date.now() - tStart, status: closed.status, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null })
    return closed
  }

  // The separate review call (engine/review.ts): a fresh model call checks the survivors for SAFETY only. Its vetoes are applied by the
  // same referee code (a vetoed main → slot 2 is promoted; a failed or unreviewed freestyle → dropped). It never throws, and a review that
  // cannot be used (timeout, error) costs the customer nothing but the freestyle: the mains stand on the referee alone.
  opts.onStage?.('checking')
  const tReview = Date.now()
  // (No live main candidate left → nothing to review: a freestyle cannot be shown alone, so it is dropped and the replacement is tried at once.)
  const hasMain = refereed.candidates.some((c) => !c.eliminated && c.slot !== 'freestyle')
  const review = hasMain
    ? await runReview(refereed, palette, trimmed, context, { apiKey: opts.apiKey, signal: opts.signal, model: REVIEW_MODEL, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
    : { ran: false, skipped_reason: 'no main candidate left to review', verdicts: [] }
  const reviewMs = Date.now() - tReview
  const reviewed = applyReviewVerdicts(refereed, palette, trimmed, review, { deferInsufficient: true })

  // A main slot that is EMPTY (never produced, or removed by the referee or the review) is replaced — never an extra card beside a filled one.
  const tReplace = Date.now()
  const completed = await completeMains(reviewed, palette, trimmed, context, prompt, {
    apiKey: opts.apiKey,
    signal: opts.signal,
    // the replacement is a selection (it must pass the person test): the selection model; only its review uses the review model
    model: process.env.ICHIREI_REPLACE_MODEL ?? MODEL,
    reviewModel: REVIEW_MODEL,
    onUsage: opts.onUsage,
    onStage: opts.onStage,
  })
  // The last gate: at most one main, one second, one freestyle — and never zero cards without a question.
  const final = finalizeResult(completed)
  logTiming({ attempts, max_tokens_used: maxTokens, select_ms: selectMs, review_ms: reviewMs, replace_ms: Date.now() - tReplace, total_ms: Date.now() - tStart, status: final.status, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null })
  return final
}

/** One line per run: where the time went (no story text). Read it in the Cloud Run logs. */
function logTiming(t: { attempts: number; max_tokens_used: number; select_ms: number; review_ms: number; replace_ms: number; total_ms: number; status: string; stop_reason: string | null; output_tokens: number | null }) {
  console.log(`[ichirei-timing] ${JSON.stringify({ ...t, model: MODEL, effort: EFFORT, max_tokens: MAX_TOKENS, review_model: REVIEW_MODEL })}`)
}

const REVIEW_RESERVE_MS = 20_000 // time kept for the review after a retried selection
const MIN_RETRY_MS = 30_000 // a retry with less than this left would only time out again

export const ENGINE_CONFIG = { MODEL, EFFORT, MAX_TOKENS, MAX_TOKENS_RETRY, REVIEW_MODEL, REVIEW_EFFORT: process.env.ICHIREI_REVIEW_EFFORT ?? 'low', CALL_TIMEOUT_MS: callTimeoutMs(), REVIEW_TIMEOUT_MS: reviewTimeoutMs() }
