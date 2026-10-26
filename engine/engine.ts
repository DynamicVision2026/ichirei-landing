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
const EFFORT = (process.env.ICHIREI_EFFORT ?? 'high') as
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
const MAX_TOKENS = Number(process.env.ICHIREI_MAX_TOKENS ?? 20000)

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

  // Stream + finalMessage so heavy reasoning at high effort doesn't hit an HTTP
  // timeout; the function still returns one assembled JSON response to the caller.
  const stream = client.messages.stream(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      output_config: { effort: EFFORT },
      messages: [{ role: 'user', content: prompt }],
    },
    opts.signal ? { signal: opts.signal } : undefined,
  )
  let firstDelta = true
  stream.on('text', (text) => {
    if (firstDelta) {
      firstDelta = false
      opts.onStage?.('choosing')
    }
    opts.onDelta?.(text)
  })
  const message = await stream.finalMessage()
  const selectMs = Date.now() - tStart
  opts.onUsage?.('select', { model: MODEL, input_tokens: message.usage?.input_tokens ?? 0, output_tokens: message.usage?.output_tokens ?? 0 })

  const textOut = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')

  if (message.stop_reason === 'refusal') {
    throw new Error('Model refused the request')
  }

  // The prompt asks the model to echo the context; stamp the request's own values
  // so the echo can never disagree with what the caller actually sent. (Plumbing,
  // not selection: nothing about the candidates is touched.)
  const extracted = extractJson(textOut)
  const stamped: EngineResult = {
    ...extracted,
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

  // Palette referee (engine/palette.ts, data in engine/palette.csv): removes hard_block
  // candidates and refuses an anchorless context_required kanji as primary; promotes slot 2, or
  // returns `insufficient` when no main candidate survives. A missing or malformed palette fails the
  // request loudly (above), never silently skips the blocklist.
  const refereed = applyPalette(stamped, palette, trimmed)
  if (refereed.status !== 'sufficient') {
    logTiming({ select_ms: selectMs, review_ms: 0, replace_ms: 0, total_ms: Date.now() - tStart, status: refereed.status, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null })
    return refereed
  }

  // The separate review call (engine/review.ts): a fresh model call checks the survivors again.
  // Its verdicts are applied by the same referee code (a failed main → slot 2; a failed or
  // unreviewed freestyle → dropped). It never throws; it never costs the customer their result.
  opts.onStage?.('checking')
  const tReview = Date.now()
  const review = await runReview(refereed, palette, trimmed, context, { apiKey: opts.apiKey, signal: opts.signal, model: process.env.ICHIREI_REVIEW_MODEL ?? MODEL, onUsage: opts.onUsage ? (u) => opts.onUsage!('review', u) : undefined })
  const reviewMs = Date.now() - tReview
  const reviewed = applyReviewVerdicts(refereed, palette, trimmed, review)

  // A main slot that ended up empty (never produced, or removed by the referee or the review) is replaced, not shown as two cards.
  const tReplace = Date.now()
  const completed = await completeMains(reviewed, palette, trimmed, context, prompt, {
    apiKey: opts.apiKey,
    signal: opts.signal,
    model: process.env.ICHIREI_REPLACE_MODEL ?? process.env.ICHIREI_REVIEW_MODEL ?? MODEL,
    onUsage: opts.onUsage,
    onStage: opts.onStage,
  })
  logTiming({ select_ms: selectMs, review_ms: reviewMs, replace_ms: Date.now() - tReplace, total_ms: Date.now() - tStart, status: completed.status, stop_reason: message.stop_reason, output_tokens: message.usage?.output_tokens ?? null })
  return completed
}

/** One line per run: where the time went (no story text). Read it in the Cloud Run logs. */
function logTiming(t: { select_ms: number; review_ms: number; replace_ms: number; total_ms: number; status: string; stop_reason: string | null; output_tokens: number | null }) {
  console.log(`[ichirei-timing] ${JSON.stringify({ ...t, model: MODEL, effort: EFFORT, max_tokens: MAX_TOKENS })}`)
}

export const ENGINE_CONFIG = { MODEL, EFFORT, MAX_TOKENS }
